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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const requestedEffort = (env.AGENT_REASONING_EFFORT ?? 'high') as Config['reasoningEffort'];
  if (!effort.has(requestedEffort))
    throw new Error('AGENT_REASONING_EFFORT must be low, medium, high, xhigh, or max.');
  const maxToolIterations = Number(env.AGENT_MAX_TOOL_ITERATIONS ?? '16');
  if (!Number.isInteger(maxToolIterations) || maxToolIterations < 1 || maxToolIterations > 50)
    throw new Error('AGENT_MAX_TOOL_ITERATIONS must be an integer between 1 and 50.');
  return {
    gatewayBaseUrl: validUrl(required(env, 'TFY_GATEWAY_BASE_URL'), 'TFY_GATEWAY_BASE_URL'),
    apiKey: required(env, 'TFY_API_KEY'),
    model: required(env, 'TFY_MODEL'),
    cdpUrl: validUrl(required(env, 'CDP_URL'), 'CDP_URL'),
    studioUrl: validUrl(required(env, 'STUDIO_URL'), 'STUDIO_URL'),
    maxToolIterations,
    reasoningEffort: requestedEffort,
  };
}

