import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const required = {
  TFY_API_KEY: 'test-token',
  TFY_MODEL: 'openai/gpt-6-astra',
  CDP_URL: 'http://127.0.0.1:9222',
  STUDIO_URL: 'http://127.0.0.1:5173/',
};

test('adds the TrueFoundry Gateway path to a control-plane host', () => {
  const config = loadConfig({ ...required, TFY_GATEWAY_BASE_URL: 'https://example.truefoundry.cloud' });
  assert.equal(config.gatewayBaseUrl, 'https://example.truefoundry.cloud/api/llm');
});

test('keeps an explicit TrueFoundry Gateway path', () => {
  const config = loadConfig({ ...required, TFY_GATEWAY_BASE_URL: 'https://example.truefoundry.cloud/api/llm' });
  assert.equal(config.gatewayBaseUrl, 'https://example.truefoundry.cloud/api/llm');
});

test('rejects an unsupported Gateway subpath before sending a request', () => {
  assert.throws(
    () => loadConfig({ ...required, TFY_GATEWAY_BASE_URL: 'https://example.truefoundry.cloud/v1' }),
    /control-plane host or end with \/api\/llm/,
  );
});
