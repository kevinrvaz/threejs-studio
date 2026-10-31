import { useEffect, useRef, useState } from 'react';
import { Bot, Settings2, X } from 'lucide-react';
import { flushSync } from 'react-dom';
import { buildAgentTools } from './agentTools';
import { PanelAgent, responsesEndpoint } from './panelAgent';
import type { Project } from './model';
import { readReferenceImages } from './agentImages';
import type { ReferenceImage } from './agentImages';

export function AgentPanel({
  open,
  close,
  ready,
  persist,
}: {
  open: boolean;
  close: () => void;
  ready: boolean;
  persist: (p: Project) => Promise<void>;
}) {
  const [gateway, setGateway] = useState('https://stranger-builds.truefoundry.cloud');
  const [model, setModel] = useState('tfy-managed/gpt-6-astra');
  const [maxIterations, setMaxIterations] = useState(100);
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [messages, setMessages] = useState<
    { role: string; text: string; images?: ReferenceImage[] }[]
  >([]);
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageLock = useRef(false);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState<{
    text: string;
    resolve: (value: boolean) => void;
  } | null>(null);
  const agent = useRef<PanelAgent | null>(null);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, approval, open]);
  function add(role: string, text: string) {
    setMessages((m) => [...m, { role, text }]);
  }
  function disconnect() {
    agent.current = null;
    setKey('');
    setConfigured(false);
    setMessages([]);
    setImages([]);
    setError('');
  }
  async function attach(files: File[]) {
    if (!files.length || running || imageLock.current) return;
    imageLock.current = true;
    setLoadingImages(true);
    setError('');
    try {
      const added = await readReferenceImages(files, images);
      setImages((current) => [...current, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach images.');
    } finally {
      imageLock.current = false;
      setLoadingImages(false);
    }
  }
  async function send() {
    if ((!prompt.trim() && !images.length) || loadingImages || running || !agent.current || !ready)
      return;
    const request = prompt.trim() || 'Create an editable 3D scene based on these reference images.';
    const references = images;
    setImages([]);
    setPrompt('');
    setRunning(true);
    setStopping(false);
    setError('');
    setMessages((m) => [...m, { role: 'You', text: request, images: references }]);
    const abort = new AbortController();
    controller.current = abort;
    // Bound network waits and the overall run, including approvals.
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 30 * 60_000);
    try {
      await agent.current.respond(
        request,
        abort.signal,
        (text) => add('Agent', text),
        (name, args) =>
          new Promise<boolean>((resolve) => {
            const finish = (value: boolean) => {
              abort.signal.removeEventListener('abort', cancel);
              setApproval(null);
              resolve(value);
            };
            const cancel = () => finish(false);
            abort.signal.addEventListener('abort', cancel, { once: true });
            setApproval({ text: `${name}\n${JSON.stringify(args, null, 2)}`, resolve: finish });
          }),
        references,
      );
    } catch (e) {
      setError(
        abort.signal.aborted
          ? `${timedOut ? 'Stopped at the 30-minute time limit.' : 'Stopped by you.'} Completed edits remain in the scene; use Undo to revert them.`
          : e instanceof Error
            ? e.message
            : 'Agent failed.',
      );
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      setRunning(false);
      setStopping(false);
    }
  }
  return (
    <aside className="agent-panel" aria-label="Modelling agent" hidden={!open}>
      <div className="agent-panel-header">
        <Bot size={17} />
        <strong>Modelling agent</strong>
        {running && (
          <button
            className="agent-stop"
            type="button"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              controller.current?.abort();
            }}
          >
            {stopping ? 'Stopping…' : 'Stop agent'}
          </button>
        )}
        <button title="Agent settings" disabled={running || loadingImages} onClick={disconnect}>
          <Settings2 size={16} />
        </button>
        <button title="Close agent panel" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {!configured ? (
        <form
          className="agent-config"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            try {
              responsesEndpoint(gateway);
              if (!key.trim() || !model.trim()) throw new Error('Enter an API key and model slug.');
              if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 500)
                throw new Error('Tool iteration limit must be between 1 and 500.');
              agent.current = new PanelAgent(
                {
                  gateway: gateway.trim(),
                  model: model.trim(),
                  key: key.trim(),
                  maxToolIterations: maxIterations,
                },
                buildAgentTools({ persist, flushUI: () => flushSync(() => {}) }),
              );
              setKey('');
              setConfigured(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Invalid configuration');
            }
          }}
        >
          <h2>Configure your agent</h2>
          <p>Connect TrueFoundry to build and edit this scene through conversation.</p>
          <label>
            Gateway URL
            <input
              required
              type="url"
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              autoComplete="off"
            />
          </label>
          <small>TFY_GATEWAY_BASE_URL · host or /api/llm URL</small>
          <label>
            API key
            <input
              required
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              placeholder="Enter your TrueFoundry API key"
            />
          </label>
          <small>TFY_API_KEY · kept in memory for this tab only</small>
          <label>
            Model slug
            <input
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              autoComplete="off"
            />
          </label>
          <small>TFY_MODEL</small>
          <label>
            Tool iteration limit
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              required
              value={maxIterations}
              onChange={(e) => setMaxIterations(e.target.valueAsNumber)}
            />
          </label>
          <small>Default 100 · up to 500 rounds per message. Stop the agent at any time.</small>
          <p>
            Your prompts and tool results are sent to this gateway. The key is cleared on reload or
            when you open Settings.
          </p>
          <div className="agent-connection">
            Connected to this studio tab. Chrome debugging and CDP_URL are only needed by the
            standalone CLI agent.
          </div>
          <button className="agent-primary" type="submit" disabled={!ready}>
            Start chatting
          </button>
        </form>
      ) : (
        <>
          <div className="agent-model">
            {model} · This tab · {maxIterations} iterations max
          </div>
          <div className="agent-messages" role="log" aria-label="Agent conversation">
            {!messages.length && (
              <div className="agent-empty">
                <Bot size={28} />
                <h2>What would you like to build?</h2>
                <p>
                  Describe an environment, add objects, or refine your scene. Edits appear here and
                  support Undo.
                </p>
                <button onClick={() => setPrompt('Inspect my scene and suggest improvements.')}>
                  Suggest scene improvements
                </button>
              </div>
            )}
            {messages.map((m, i) => (
              <div className={`agent-message ${m.role === 'You' ? 'from-user' : ''}`} key={i}>
                <strong>{m.role}</strong>
                <p>{m.text}</p>
                {!!m.images?.length && (
                  <div className="agent-reference-images">
                    {m.images.map((image, index) => (
                      <img key={index} src={image.url} alt={image.name} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {running && (
              <p className="agent-working" role="status">
                Agent working…
              </p>
            )}
            {approval && (
              <div className="agent-approval">
                <strong>Approve scene change?</strong>
                <pre>{approval.text}</pre>
                <button onClick={() => approval.resolve(true)}>Approve</button>
                <button onClick={() => approval.resolve(false)}>Decline</button>
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="agent-composer"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void attach(Array.from(e.dataTransfer.files));
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                void attach(files);
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              aria-label="Reference images"
              onChange={(e) => {
                void attach(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={running || loadingImages || images.length >= 4}
              onClick={() => imageInput.current?.click()}
            >
              {loadingImages ? 'Reading images…' : 'Attach images'}
            </button>
            <small>Drop or paste PNG, JPEG or WebP images here. Up to 4, 8 MB each.</small>
            {!!images.length && (
              <div className="agent-reference-images">
                {images.map((image, index) => (
                  <div key={index}>
                    <img src={image.url} alt={image.name} />
                    <button
                      type="button"
                      disabled={loadingImages}
                      aria-label={`Remove ${image.name}`}
                      onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="agent-prompt">
              Message agent
            </label>
            <textarea
              id="agent-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your scene…"
              disabled={running}
              rows={3}
            />
            {!running && (
              <button
                className="agent-primary"
                disabled={!ready || loadingImages || (!prompt.trim() && !images.length)}
              >
                Send message
              </button>
            )}
          </form>
        </>
      )}
      {error && (
        <p className="agent-error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
