export interface Config {
  gatewayBaseUrl: string;
  apiKey: string;
  model: string;
  cdpUrl: string;
  studioUrl: string;
  maxToolIterations: number;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

const effort = new Set<Config['reasoningEffort']>(['low', 'medium', 'high', 'xhigh', 'max']);

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validUrl(value: string, name: string) {
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
}

function gatewayBaseUrl(value: string) {
  const parsed = new URL(validUrl(value, 'TFY_GATEWAY_BASE_URL'));
  const path = parsed.pathname.replace(/\/$/, '');
  // A TrueFoundry control-plane hostname exposes the OpenAI-compatible Gateway
  // below /api/llm. Accept both the host and the fully copied Gateway URL.
  if (!path) parsed.pathname = '/api/llm';
  else if (!path.endsWith('/api/llm'))
    throw new Error('TFY_GATEWAY_BASE_URL must be the control-plane host or end with /api/llm.');
  return parsed.toString().replace(/\/$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const requestedEffort = (env.AGENT_REASONING_EFFORT ?? 'high') as Config['reasoningEffort'];
  if (!effort.has(requestedEffort))
    throw new Error('AGENT_REASONING_EFFORT must be low, medium, high, xhigh, or max.');
  const maxToolIterations = Number(env.AGENT_MAX_TOOL_ITERATIONS ?? '16');
  if (!Number.isInteger(maxToolIterations) || maxToolIterations < 1 || maxToolIterations > 50)
    throw new Error('AGENT_MAX_TOOL_ITERATIONS must be an integer between 1 and 50.');
  return {
    gatewayBaseUrl: gatewayBaseUrl(required(env, 'TFY_GATEWAY_BASE_URL')),
    apiKey: required(env, 'TFY_API_KEY'),
    model: required(env, 'TFY_MODEL'),
    cdpUrl: validUrl(required(env, 'CDP_URL'), 'CDP_URL'),
    studioUrl: validUrl(required(env, 'STUDIO_URL'), 'STUDIO_URL'),
    maxToolIterations,
    reasoningEffort: requestedEffort,
  };
}

