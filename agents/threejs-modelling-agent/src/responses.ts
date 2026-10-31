import { responsesEndpoint, type Config } from './config.js';
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

type InputItem =
  | { role: 'user'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export class TrueFoundryResponsesClient {
  constructor(private readonly config: Config) {}

  async create(input: InputItem[], tools: WebMCPTool[], previousResponseId?: string): Promise<ModelResponse> {
    const response = await fetch(responsesEndpoint(this.config.gatewayBaseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'X-TFY-METADATA': JSON.stringify({ application: 'threejs-modelling-agent' }),
      },
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
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`TrueFoundry Responses API returned ${response.status}: ${detail.slice(0, 800)}`);
    }
    const body = (await response.json()) as ModelResponse;
    if (!body.id || !Array.isArray(body.output)) throw new Error('TrueFoundry returned an invalid Responses API payload.');
    return body;
  }
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
