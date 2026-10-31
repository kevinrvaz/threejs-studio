import assert from 'node:assert/strict';
import test from 'node:test';
import { ModellingAgent } from '../src/agent.js';

test('requires confirmation before executing a delete request', async () => {
    let executeCalls = 0;
    const execute = async () => {
      executeCalls += 1;
      return { raw: {}, data: {}, isError: false };
    };
    let modelCall = 0;
    const calls: unknown[][] = [];
    const create = async (input: unknown[]) => {
      calls.push(input);
      modelCall += 1;
      if (modelCall === 1) return {
        id: 'first',
        output: [
          {
            type: 'function_call',
            call_id: 'call-delete',
            name: 'studio_organize_objects',
            arguments: JSON.stringify({ action: 'delete', ids: ['cube-1'] }),
          },
        ],
      };
      return { id: 'final', output: [], output_text: 'Kept the object unchanged.' };
    };
    let confirmed = 0;
    const agent = new ModellingAgent(
      { maxToolIterations: 2 },
      {
        browser: {
          getTools: async () => [
            { name: 'studio_organize_objects', description: 'Organize scene objects', inputSchema: {} },
          ],
          execute,
        },
        model: { create },
        confirm: async () => {
          confirmed += 1;
          return false;
        },
        write: () => undefined,
      },
    );
    await agent.start();
    assert.equal(await agent.respond('Delete the cube'), 'Kept the object unchanged.');
    assert.equal(confirmed, 1);
    assert.equal(executeCalls, 0);
    assert.deepEqual(calls[1], [
      {
        type: 'function_call_output',
        call_id: 'call-delete',
        output: JSON.stringify({ ok: false, error: 'User declined the delete operation.' }),
      },
    ]);
  });
