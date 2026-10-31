import { isDeleteRequest, type Confirm } from './confirmation.js';
import type { Config } from './config.js';
import { functionCalls, TrueFoundryResponsesClient } from './responses.js';
import type { WebMCPBrowser, WebMCPTool } from './webmcp.js';

export interface AgentDependencies {
  browser: Pick<WebMCPBrowser, 'getTools' | 'execute'>;
  model: Pick<TrueFoundryResponsesClient, 'create'>;
  confirm: Confirm;
  write: (message: string) => void;
}

export class ModellingAgent {
  private previousResponseId: string | undefined;
  private tools: WebMCPTool[] = [];

  constructor(
    private readonly config: Pick<Config, 'maxToolIterations'>,
    private readonly deps: AgentDependencies,
  ) {}

  async start() {
    this.tools = await this.deps.browser.getTools();
    if (!this.tools.length) throw new Error('WebMCP reported no tools in the selected Studio tab.');
    this.deps.write(`Connected to Studio: ${this.tools.length} WebMCP tools discovered.`);
  }

  async respond(userRequest: string) {
    let response = await this.deps.model.create(
      [{ role: 'user', content: userRequest }],
      this.tools,
      this.previousResponseId,
    );
    let iterations = 0;
    while (true) {
      const calls = functionCalls(response);
      if (!calls.length) {
        this.previousResponseId = response.id;
        const text = response.output_text?.trim() || 'The model completed without a text response.';
        this.deps.write(`\nAgent: ${text}\n`);
        return text;
      }
      iterations += 1;
      if (iterations > this.config.maxToolIterations)
        throw new Error(`Stopped after ${this.config.maxToolIterations} tool iterations to prevent an infinite loop.`);
      const outputs = [];
      for (const call of calls) {
        let args: Record<string, unknown>;
        try {
          const candidate: unknown = JSON.parse(call.arguments);
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            throw new Error('Tool arguments must be a JSON object.');
          args = candidate as Record<string, unknown>;
        } catch (error) {
          outputs.push({
            type: 'function_call_output' as const,
            call_id: call.call_id,
            output: JSON.stringify({ ok: false, error: `Invalid model tool arguments: ${String(error)}` }),
          });
          continue;
        }
        if (isDeleteRequest(call.name, args)) {
          const approved = await this.deps.confirm(
            `\nDelete requested through ${call.name}:\n${JSON.stringify(args, null, 2)}\nApprove?`,
          );
          if (!approved) {
            outputs.push({
              type: 'function_call_output' as const,
              call_id: call.call_id,
              output: JSON.stringify({ ok: false, error: 'User declined the delete operation.' }),
            });
            continue;
          }
        }
        this.deps.write(`→ ${call.name}(${JSON.stringify(args)})`);
        try {
          const result = await this.deps.browser.execute(call.name, args);
          const output = JSON.stringify(result.data);
          this.deps.write(result.isError ? `  Tool reported an error: ${output}` : '  Tool completed.');
          outputs.push({ type: 'function_call_output' as const, call_id: call.call_id, output });
        } catch (error) {
          outputs.push({
            type: 'function_call_output' as const,
            call_id: call.call_id,
            output: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          });
        }
      }
      response = await this.deps.model.create(outputs, this.tools, response.id);
    }
  }
}
