import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useWebMCP } from 'use-webmcp-tool';
import type { WebMCPState } from 'use-webmcp-tool';
import { Bot } from 'lucide-react';
import { buildAgentTools } from './agentTools';
import type { AgentTool } from './agentTools';
import type { Project } from './model';
function Registration({
  tool,
  ready,
  onState,
}: {
  tool: AgentTool;
  ready: boolean;
  onState: (name: string, state: WebMCPState) => void;
}) {
  const state = useWebMCP({ ...tool, enabled: ready });
  useEffect(() => {
    onState(tool.name, state);
  }, [state, tool.name, onState]);
  return null;
}
export function WebMCPBridge({
  ready,
  persist,
}: {
  ready: boolean;
  persist: (p: Project) => Promise<void>;
}) {
  const tools = useMemo(
    () => buildAgentTools({ persist, flushUI: () => flushSync(() => {}) }),
    [persist],
  );
  const [statuses, setStatuses] = useState<Record<string, WebMCPState>>({});
  const onState = useCallback(
    (name: string, state: WebMCPState) => setStatuses((s) => ({ ...s, [name]: state })),
    [],
  );
  const states = Object.values(statuses),
    registered = states.filter((s) => s.registered).length;
  const supported = states.some((s) => s.supported),
    error = states.find((s) => s.error)?.error;
  const title = error
    ? `WebMCP registration failed: ${error.message}`
    : supported
      ? `${registered} tools exposed to browser agents. Agent edits share the editor's undo history. See README for schemas and usage.`
      : 'WebMCP is unavailable in this browser. Use a compatible Chromium browser with WebMCP enabled. The editor remains fully usable.';
  return (
    <>
      <span
        className={`agent-status ${registered === tools.length ? 'agent-ready' : ''}`}
        title={title}
      >
        <Bot size={12} />
        {registered === tools.length
          ? `WebMCP · ${registered} tools`
          : supported
            ? 'WebMCP connecting…'
            : 'WebMCP unavailable'}
      </span>
      {tools.map((tool) => (
        <Registration key={tool.name} tool={tool} ready={ready} onState={onState} />
      ))}
    </>
  );
}
