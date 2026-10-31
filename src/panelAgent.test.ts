import { afterEach, expect, test, vi } from 'vitest';
import { PanelAgent, responsesEndpoint } from './panelAgent';
import type { AgentTool } from './agentTools';
afterEach(() => vi.unstubAllGlobals());
test('normalizes gateway host and rejects insecure or credential-bearing URLs', () => {
  expect(responsesEndpoint('https://gateway.example')).toBe(
    'https://gateway.example/api/llm/v1/responses',
  );
  expect(responsesEndpoint('https://gateway.example/api/llm/')).toBe(
    'https://gateway.example/api/llm/v1/responses',
  );
  for (const url of [
    'http://gateway.example',
    'https://user:pass@gateway.example',
    'https://gateway.example/?secret=x',
  ])
    expect(() => responsesEndpoint(url)).toThrow();
});
test('declined deletion and unknown tools cannot execute; raw HTTP bodies never enter errors', async () => {
  const execute = vi.fn();
  const tool = {
    name: 'studio_organize_objects',
    description: '',
    inputSchema: {},
    execute,
  } as unknown as AgentTool;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              call_id: '1',
              name: tool.name,
              arguments: '{"action":"delete"}',
            },
            { type: 'function_call', call_id: '2', name: 'arbitrary_javascript', arguments: '{}' },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(new Response('sensitive gateway body', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const agent = new PanelAgent(
    { gateway: 'https://gateway.example', key: 'secret-key', model: 'model' },
    [tool],
  );
  await expect(
    agent.respond('delete', new AbortController().signal, vi.fn(), async () => false),
  ).rejects.toThrow('HTTP 401');
  expect(execute).not.toHaveBeenCalled();
  const body = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(body.input[3].output).toContain('declined');
  expect(body.input[4].output).toContain('Unknown');
  expect(JSON.stringify(body)).not.toContain('secret-key');
});

test('default permits more than 16 rounds and configured limit stops further tools', async () => {
  const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
  const tool = {
    name: 'studio_get_scene',
    description: '',
    inputSchema: {},
    execute,
  } as unknown as AgentTool;
  let round = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output:
              ++round <= 17
                ? [
                    {
                      type: 'function_call',
                      call_id: String(round),
                      name: tool.name,
                      arguments: '{}',
                    },
                  ]
                : [],
          }),
        ),
    ),
  );
  const config = { gateway: 'https://gateway.example', key: 'key', model: 'model' };
  await new PanelAgent(config, [tool]).respond(
    'build',
    new AbortController().signal,
    vi.fn(),
    async () => true,
  );
  expect(execute).toHaveBeenCalledTimes(17);
  round = 0;
  execute.mockClear();
  await expect(
    new PanelAgent({ ...config, maxToolIterations: 2 }, [tool]).respond(
      'build',
      new AbortController().signal,
      vi.fn(),
      async () => true,
    ),
  ).rejects.toThrow('2-iteration limit');
  expect(execute).toHaveBeenCalledTimes(2);
});

test('abort prevents any more calls in a returned tool batch', async () => {
  const abort = new AbortController();
  const execute = vi.fn(async () => {
    abort.abort();
    return { content: [] };
  });
  const tool = {
    name: 'studio_get_scene',
    description: '',
    inputSchema: {},
    execute,
  } as unknown as AgentTool;
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          output: [1, 2].map((i) => ({
            type: 'function_call',
            call_id: String(i),
            name: tool.name,
            arguments: '{}',
          })),
        }),
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    new PanelAgent({ gateway: 'https://gateway.example', key: 'key', model: 'model' }, [
      tool,
    ]).respond('build', abort.signal, vi.fn(), async () => true),
  ).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
