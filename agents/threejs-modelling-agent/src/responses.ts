import { TrueFoundryClient } from 'truefoundry-sdk';
import type { Config } from './config.js';
import { MODELLING_INSTRUCTIONS } from './prompt.js';
import type { WebMCPTool } from './webmcp.js';

export interface FunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface ModelResponse {
  id: string;
  output: Array<FunctionCall | { type: string; [key: string]: unknown }>;
  output_text?: string;
}

export class TrueFoundryGatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'TrueFoundryGatewayError';
  }
}

type InputItem =
  | { role: 'user'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export class TrueFoundryResponsesClient {
  private readonly client: TrueFoundryClient;
  private readonly endpoint: string;

  constructor(private readonly config: Config) {
    this.client = new TrueFoundryClient({
      baseUrl: config.gatewayBaseUrl,
      apiKey: config.apiKey,
      headers: { 'X-TFY-METADATA': JSON.stringify({ application: 'threejs-modelling-agent' }) },
    });
    this.endpoint = `${config.gatewayBaseUrl}/v1/responses`;
  }

  async create(input: InputItem[], tools: WebMCPTool[], previousResponseId?: string): Promise<ModelResponse> {
    // The SDK's custom fetch preserves its authentication, retry, timeout, and logging behavior
    // while reaching the Gateway's OpenAI-compatible endpoint.
    let response: Response;
    try {
      response = await this.client.fetch('/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          instructions: MODELLING_INSTRUCTIONS,
          previous_response_id: previousResponseId,
          input,
          tools: tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
          reasoning: { effort: this.config.reasoningEffort },
          metadata: { application: 'threejs-modelling-agent' },
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TrueFoundryGatewayError(
        `Could not reach the TrueFoundry Responses API at ${this.endpoint}. Check TFY_GATEWAY_BASE_URL, network access, and gateway availability. ${detail}`,
      );
    }
    if (!response.ok) {
      throw await gatewayError(response, this.endpoint);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TrueFoundryGatewayError(
        `TrueFoundry returned a successful but non-JSON response from ${this.endpoint}.`,
        response.status,
        requestId(response),
      );
    }
    if (!isModelResponse(body))
      throw new TrueFoundryGatewayError(
        `TrueFoundry returned an incomplete Responses API payload from ${this.endpoint}.`,
        response.status,
        requestId(response),
      );
    return body;
  }
}

function requestId(response: Response) {
  return response.headers.get('x-request-id') ?? response.headers.get('x-tfy-request-id') ?? undefined;
}

function isModelResponse(value: unknown): value is ModelResponse {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'output' in value && Array.isArray(value.output));
}

async function gatewayError(response: Response, endpoint: string) {
  const raw = (await response.text()).trim();
  let detail = raw;
  try {
    const body: unknown = JSON.parse(raw);
    if (body && typeof body === 'object') {
      const error = 'error' in body ? body.error : body;
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
        detail = error.message;
    }
  } catch {
    // Gateways occasionally return text or HTML error pages; retain a short safe excerpt.
  }
  const guidance: Record<number, string> = {
    400: 'Check the configured model slug and Responses API request shape.',
    401: 'Check TFY_API_KEY and rotate it if it may have been exposed.',
    403: 'The token is valid but lacks access to this model or Gateway route.',
    404: 'Check TFY_GATEWAY_BASE_URL. It should resolve to the TrueFoundry /api/llm Gateway.',
    405: 'The configured URL is not the TrueFoundry OpenAI-compatible Gateway. Use the control-plane host or a URL ending in /api/llm.',
    408: 'The Gateway timed out. Retry the request after confirming Gateway health.',
    429: 'The Gateway rate-limited this request. Wait and retry, or review its budget and rate-limit policy.',
  };
  const suffix = response.status >= 500 ? 'The Gateway or upstream model failed; retry shortly and inspect its request trace.' : guidance[response.status] ?? 'Inspect the TrueFoundry request trace for this call.';
  const id = requestId(response);
  return new TrueFoundryGatewayError(
    `TrueFoundry Responses API request failed (${response.status}) at ${endpoint}. ${suffix}${detail ? ` Detail: ${detail.slice(0, 800)}` : ''}${id ? ` Request ID: ${id}.` : ''}`,
    response.status,
    id,
  );
}

export function functionCalls(response: ModelResponse): FunctionCall[] {
  return response.output.filter(
    (item): item is FunctionCall =>
      item.type === 'function_call' &&
      typeof item.call_id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.arguments === 'string',
  );
}
