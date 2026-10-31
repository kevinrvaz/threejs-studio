import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentPanel } from './AgentPanel';
import type { CSSProperties, ReactNode } from 'react';
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  Folder,
  FolderOpen,
  Focus,
  Globe2,
  Grid2X2,
  Group,
  Image,
  Layers,
  Lightbulb,
  LockKeyhole,
  Magnet,
  Maximize,
  MousePointer2,
  Move3D,
  PanelBottom,
  Plus,
  Redo2,
  Rotate3D,
  Save,
  Scaling,
  Search,
  Settings2,
  Sun,
  Trash2,
  Undo2,
  UnlockKeyhole,
  Upload,
  Video,
  X,
  Play,
  Square,
  Cylinder,
  Triangle,
  CircleDashed,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { WebMCPBridge } from './WebMCPBridge';
import { Viewport, viewportActions } from './Viewport';
import { useStudio, notify } from './store';
import { isLocked, material, newProject, primitiveKinds } from './model';
import type { Kind, Material, Project, SceneNode, Vec3 } from './model';
import {
  assetUrl,
  deleteProject,
  exportProject,
  importFiles,
  lastProject,
  listProjects,
  loadProject,
  modelNodes,
  modelPart,
  openProject,
  saveProject,
  pruneAssets,
  thumbnails,
} from './assets';
import type { SavedProject } from './assets';
import { Mesh, MeshStandardMaterial } from 'three';
const icons: Record<string, typeof Box> = {
  box: Box,
  sphere: Circle,
  cylinder: Cylinder,
  cone: Triangle,
  plane: Square,
  torus: CircleDashed,
  group: Folder,
  model: Boxes,
  camera: Video,
  ambient: Sun,
  hemisphere: Globe2,
  directional: Sun,
  point: Lightbulb,
  spot: Lightbulb,
};
const labels: Record<string, string> = {
  box: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Torus',
  group: 'Empty group',
  camera: 'Camera',
  ambient: 'Ambient light',
  hemisphere: 'Sky light',
  directional: 'Directional light',
  point: 'Point light',
  spot: 'Spot light',
};
function Icon({ kind, size = 15 }: { kind: string; size?: number }) {
  const I = icons[kind] || Box;
  return <I size={size} />;
}
function Button({
  children,
  title,
  onClick,
  active,
  disabled,
  className = '',
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={() => {
          const n = Number(draft);
          if (draft !== '' && Number.isFinite(n)) {
            const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
            onChange(v);
            setDraft(String(v));
          } else setDraft(String(value));
        }}
      />
    </label>
  );
}
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      <div className="section-title">
        {icon}
        <span>{title}</span>
        <ChevronDown size={13} />
      </div>
      {children}
    </section>
  );
}
function TextField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim()) onChange(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="property-row">
      <span>{label}</span>
      <div className="color-control">
        <input
          type="color"
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (value !== draft) onChange(draft);
          }}
        />
        <span>{draft.toUpperCase()}</span>
      </div>
    </label>
  );
}
function Hierarchy() {
  const s = useStudio(),
    [query, setQuery] = useState(''),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const matching = new Set(
    s.project.nodes
      .filter((n) => n.name.toLowerCase().includes(query.toLowerCase()))
      .map((n) => n.id),
  );
  if (query)
    for (const n of s.project.nodes)
      if (matching.has(n.id)) {
        let parent = n.parent;
        while (parent) {
          matching.add(parent);
          parent = s.project.nodes.find((x) => x.id === parent)?.parent || null;
        }
      }
  function drop(e: React.DragEvent, parent: string | null) {
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer.getData('application/forma-nodes');
    if (data) s.parent(JSON.parse(data), parent);
  }
  function row(n: SceneNode, depth: number): ReactNode {
    if (query && !matching.has(n.id)) return null;
    const children = s.project.nodes.filter((x) => x.parent === n.id),
      selected = s.selected.includes(n.id),
      hidden = collapsed.has(n.id) && !query;
    return (
      <div key={n.id}>
        <div
          className={`hierarchy-row ${selected ? 'selected' : ''} ${!n.visible ? 'muted' : ''}`}
          style={{ paddingLeft: 8 + depth * 15 }}
          draggable={!isLocked(s.project.nodes, n.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData(
              'application/forma-nodes',
              JSON.stringify(selected ? s.selected : [n.id]),
            );
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/forma-nodes')) e.preventDefault();
          }}
          onDrop={(e) => drop(e, n.id)}
          onClick={(e) => s.select(n.id, e.metaKey || e.ctrlKey || e.shiftKey)}
          onDoubleClick={() => useStudio.setState({ focus: s.focus + 1 })}
        >
          <button
            aria-label={`Toggle ${n.name} children`}
            className="tree-chevron"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((old) => {
                const next = new Set(old);
                next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                return next;
              });
            }}
          >
            {children.length ? (
              hidden ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )
            ) : (
              <span />
            )}
          </button>
          <Icon kind={n.kind} />
          <span className="node-name">{n.name}</span>
          <button
            title={n.visible ? 'Hide object' : 'Show object'}
            aria-label={`${n.visible ? 'Hide' : 'Show'} ${n.name}`}
            className="row-action"
            onClick={(e) => {
              e.stopPropagation();
              s.commit((p) => {
                p.nodes.find((x) => x.id === n.id)!.visible = !n.visible;
              });
            }}
          >
            {n.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            title={n.locked ? 'Unlock object' : 'Lock object'}
            aria-label={`${n.locked ? 'Unlock' : 'Lock'} ${n.name}`}
            className="row-action"
            onClick={(e) => {
              e.stopPropagation();
              s.commit((p) => {
                p.nodes.find((x) => x.id === n.id)!.locked = !n.locked;
              });
            }}
          >
            {n.locked ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}
          </button>
        </div>
        {!hidden && children.map((c) => row(c, depth + 1))}
      </div>
    );
  }
  return (
    <aside className="hierarchy panel">
      <div className="panel-heading">
        <Layers size={15} />
        <span>Hierarchy</span>
        <span className="count">{s.project.nodes.length}</span>
      </div>
      <div className="search-box">
        <Search size={13} />
        <input
          aria-label="Search objects"
          placeholder="Search objects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>⌕</kbd>
      </div>
      <div
        className="scene-root"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => drop(e, null)}
        onClick={() => s.select(null)}
      >
        <ChevronDown size={13} />
        <Globe2 size={14} />
        <span>{s.project.name}</span>
      </div>
      <div className="hierarchy-tree">
        {s.project.nodes.filter((n) => !n.parent).map((n) => row(n, 0))}
        {!s.project.nodes.length && (
          <div className="empty-state">
            Your world starts here.
            <br />
            Drag a shape into the scene.
          </div>
        )}
        <div
          className="root-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, null)}
        >
          Drop here to move to scene root
        </div>
      </div>
      <div className="hierarchy-footer">
        <Button title="Group selection (Ctrl/⌘ G)" onClick={s.group} disabled={!s.selected.length}>
          <Group size={15} />
        </Button>
        <Button
          title="Duplicate selection (Ctrl/⌘ D)"
          onClick={s.duplicate}
          disabled={!s.selected.length}
        >
          <Copy size={14} />
        </Button>
        <Button title="Delete selection" onClick={s.remove} disabled={!s.selected.length}>
          <Trash2 size={14} />
        </Button>
        <span>{s.selected.length} selected</span>
      </div>
    </aside>
  );
}
function Inspector() {
  const s = useStudio(),
    [tab, setTab] = useState<'object' | 'world'>('object');
  const nodes = s.project.nodes.filter((n) => s.selected.includes(n.id)),
    n = nodes[0],
    locked = n && isLocked(s.project.nodes, n.id);
  function patch(value: Partial<SceneNode>) {
    s.patch(s.selected, value);
  }
  function patchMaterial(value: Partial<Material>) {
    s.commit((p) =>
      p.nodes.forEach((obj) => {
        if (
          s.selected.includes(obj.id) &&
          !isLocked(p.nodes, obj.id) &&
          (obj.material || obj.kind === 'model')
        )
          obj.material = { ...getMaterial(obj), ...value };
      }),
    );
  }
  function getMaterial(obj: SceneNode): Material {
    if (obj.material) return obj.material;
    const part = obj.assetId ? modelPart(obj.assetId, obj.sourcePath) : null;
    if (part instanceof Mesh) {
      const m = Array.isArray(part.material) ? part.material[0] : part.material;
      if (m instanceof MeshStandardMaterial)
        return {
          color: `#${m.color.getHexString()}`,
          roughness: m.roughness,
          metalness: m.metalness,
          opacity: m.opacity,
        };
    }
    return material();
  }
  const m = n ? getMaterial(n) : material();
  const hasMaterial =
    n && (n.material || (n.assetId && modelPart(n.assetId, n.sourcePath) instanceof Mesh));
  return (
    <aside className="inspector panel">
      <div className="panel-heading">
        <Settings2 size={15} />
        <span>Inspector</span>
        <span className="panel-spacer" />
        <SlidersIcon />
      </div>
      <div className="panel-tabs">
        <button className={tab === 'object' ? 'selected' : ''} onClick={() => setTab('object')}>
          Object
        </button>
        <button className={tab === 'world' ? 'selected' : ''} onClick={() => setTab('world')}>
          Environment
        </button>
      </div>
      <div className="inspector-scroll">
        {tab === 'world' ? (
          <>
            <Section title="Environment" icon={<Globe2 size={14} />}>
              <ColorField
                label="Background"
                value={s.project.environment.background}
                onChange={(v) =>
                  s.commit((p) => {
                    p.environment.background = v;
                  })
                }
              />
              <Field
                label="Exposure"
                value={s.project.environment.exposure}
                min={0}
                max={10}
                onChange={(v) =>
                  s.commit((p) => {
                    p.environment.exposure = v;
                  })
                }
              />
              <label className="property-row">
                <span>HDR lighting</span>
                <select
                  aria-label="HDR lighting"
                  value={s.project.environment.environmentId || ''}
                  onChange={(e) =>
                    s.commit((p) => {
                      p.environment.environmentId = e.target.value || undefined;
                    })
                  }
                >
                  <option value="">None</option>
                  {s.project.assets
                    .filter((a) => a.type === 'environment')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="field-help">Import an .hdr file to add image-based lighting.</p>
            </Section>
            <Section title="Atmosphere">
              <label className="property-row">
                <span>Distance fog</span>
                <input
                  type="checkbox"
                  checked={s.project.environment.fog}
                  onChange={(e) =>
                    s.commit((p) => {
                      p.environment.fog = e.target.checked;
                    })
                  }
                />
              </label>
              <Field
                label="Density"
                value={s.project.environment.fogDensity}
                min={0}
                max={1}
                step={0.005}
                onChange={(v) =>
                  s.commit((p) => {
                    p.environment.fogDensity = v;
                  })
                }
              />
            </Section>
            <Section title="Preview camera" icon={<Video size={14} />}>
              <select
                aria-label="Preview camera"
                className="full-width"
                value={s.project.previewCamera || ''}
                onChange={(e) =>
                  s.commit((p) => {
                    p.previewCamera = e.target.value || null;
                  })
                }
              >
                <option value="">Editor viewpoint</option>
                {s.project.nodes
                  .filter((n) => n.kind === 'camera')
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
              <p className="field-help">Use Preview in the toolbar to see the finished scene.</p>
            </Section>
            <Section title="Snapping" icon={<Magnet size={14} />}>
              <Field
                label="Move units"
                value={s.snapMove}
                min={0.001}
                onChange={(v) => useStudio.setState({ snapMove: v })}
              />
              <Field
                label="Rotate degrees"
                value={s.snapAngle}
                min={1}
                max={180}
                step={1}
                onChange={(v) => useStudio.setState({ snapAngle: v })}
              />
              <Field
                label="Scale steps"
                value={s.snapScale}
                min={0.01}
                onChange={(v) => useStudio.setState({ snapScale: v })}
              />
            </Section>
          </>
        ) : n ? (
          <>
            <div className="object-heading">
              <div className="object-icon">
                <Icon kind={n.kind} size={23} />
              </div>
              <div>
                {nodes.length > 1 ? (
                  <strong>{nodes.length} objects selected</strong>
                ) : (
                  <TextField
                    label="Object name"
                    value={n.name}
                    onChange={(name) => patch({ name })}
                  />
                )}
                <span>
                  {nodes.length > 1
                    ? 'Shared values apply to all'
                    : labels[n.kind] || 'Imported object'}
                </span>
              </div>
            </div>
            {locked && (
              <div className="locked-note">
                <LockKeyhole size={13} /> Object is locked. Unlock it in the hierarchy.
              </div>
            )}
            <fieldset disabled={locked || s.preview}>
              <Section title="Transform" icon={<Move3D size={14} />}>
                {(['position', 'rotation', 'scale'] as const).map((key) => (
                  <div className="transform-property" key={key}>
                    <span>
                      {key[0].toUpperCase() + key.slice(1)}
                      {key === 'rotation' && <small> °</small>}
                    </span>
                    <div className="vector-fields">
                      {n[key].map((v, i) => (
                        <Field
                          key={i}
                          label={`${['X', 'Y', 'Z'][i]} ${key}`}
                          value={v}
                          step={key === 'rotation' ? 1 : 0.1}
                          onChange={(v) => {
                            if (key === 'scale' && Math.abs(v) < 0.0001) {
                              notify('Scale must be nonzero.');
                              return;
                            }
                            s.commit((p) =>
                              p.nodes.forEach((obj) => {
                                if (s.selected.includes(obj.id) && !isLocked(p.nodes, obj.id)) {
                                  const values = [...obj[key]] as Vec3;
                                  values[i] = v;
                                  obj[key] = values;
                                }
                              }),
                            );
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  className="text-button reset-transform"
                  onClick={() =>
                    patch({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
                  }
                >
                  Reset transform
                </button>
              </Section>
              {hasMaterial && (
                <Section title="Material" icon={<Circle size={14} />}>
                  <div className="material-preview">
                    <div style={{ '--material-color': m.color } as CSSProperties} />
                    <span>
                      Standard material<small>Physically based · PBR</small>
                    </span>
                  </div>
                  <ColorField
                    label="Base color"
                    value={m.color}
                    onChange={(color) => patchMaterial({ color })}
                  />
                  <Field
                    label="Metallic"
                    value={m.metalness}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(metalness) => patchMaterial({ metalness })}
                  />
                  <Field
                    label="Roughness"
                    value={m.roughness}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(roughness) => patchMaterial({ roughness })}
                  />
                  <Field
                    label="Opacity"
                    value={m.opacity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(opacity) => patchMaterial({ opacity })}
                  />
                  <label className="property-row">
                    <span>Base texture</span>
                    <select
                      aria-label="Base texture"
                      value={m.texture || ''}
                      onChange={(e) => patchMaterial({ texture: e.target.value })}
                    >
                      <option value="">
                        {n.kind === 'model' && m.texture === undefined
                          ? 'Original model texture'
                          : 'None'}
                      </option>
                      {s.project.assets
                        .filter((a) => a.type === 'texture')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </Section>
              )}
              {n.light && (
                <Section title="Light" icon={<Sun size={14} />}>
                  <ColorField
                    label="Light color"
                    value={n.light.color}
                    onChange={(color) => patch({ light: { ...n.light!, color } })}
                  />
                  <Field
                    label="Intensity"
                    value={n.light.intensity}
                    min={0}
                    step={0.25}
                    onChange={(intensity) => patch({ light: { ...n.light!, intensity } })}
                  />
                </Section>
              )}
              {n.kind === 'camera' && (
                <Section title="Camera" icon={<Video size={14} />}>
                  <Field
                    label="Field of view"
                    value={n.fov || 50}
                    min={1}
                    max={179}
                    step={1}
                    onChange={(fov) => patch({ fov })}
                  />
                  <button
                    className="secondary-button full-width"
                    onClick={() =>
                      s.commit((p) => {
                        p.previewCamera = n.id;
                      })
                    }
                  >
                    {s.project.previewCamera === n.id ? 'Active preview camera' : 'Use for preview'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => viewportActions.alignCamera?.(n.id)}
                  >
                    Align camera to editor view
                  </button>
                </Section>
              )}
              <Section title="Rendering">
                <label className="property-row">
                  <span>Visible</span>
                  <input
                    type="checkbox"
                    checked={n.visible}
                    onChange={(e) => patch({ visible: e.target.checked })}
                  />
                </label>
                <label className="property-row">
                  <span>Cast shadow</span>
                  <input
                    type="checkbox"
                    checked={n.castShadow}
                    onChange={(e) => patch({ castShadow: e.target.checked })}
                  />
                </label>
                <label className="property-row">
                  <span>Receive shadow</span>
                  <input
                    type="checkbox"
                    checked={n.receiveShadow}
                    onChange={(e) => patch({ receiveShadow: e.target.checked })}
                  />
                </label>
              </Section>
            </fieldset>
            <div className="inspector-bottom">
              Object ID <code>{n.id.slice(0, 8)}</code>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <MousePointer2 size={27} />
            <h3>A place for every detail</h3>
            <p>
              Select an object in your scene
              <br />
              to adjust its properties.
            </p>
            <button className="text-button" onClick={() => setTab('world')}>
              Edit environment <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
function SlidersIcon() {
  return <Settings2 size={13} className="muted" />;
}
function AssetBrowser({ onImport }: { onImport: () => void }) {
  const s = useStudio(),
    [category, setCategory] = useState('All assets'),
    [query, setQuery] = useState('');
  const categories = ['All assets', 'Primitives', 'Models', 'Textures', 'Lighting'];
  function drag(e: React.DragEvent, data: object) {
    e.dataTransfer.setData('application/forma', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'copy';
  }
  const primitives =
    category === 'All assets' || category === 'Primitives'
      ? primitiveKinds.filter((k) => labels[k].toLowerCase().includes(query.toLowerCase()))
      : [];
  const assets = s.project.assets.filter(
    (a) =>
      (category === 'All assets' ||
        (category === 'Models' && a.type === 'model') ||
        (category === 'Textures' && a.type === 'texture') ||
        (category === 'Lighting' && a.type === 'environment')) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const lights: Kind[] =
    category === 'Lighting'
      ? ['ambient', 'hemisphere', 'directional', 'point', 'spot', 'camera']
      : [];
  return (
    <section className="assets panel">
      <div className="asset-heading">
        <div className="panel-heading">
          <FolderOpen size={15} />
          <span>Assets</span>
        </div>
        <span className="asset-breadcrumb">
          Project <ChevronRight size={12} /> {category}
        </span>
        <div className="search-box">
          <Search size={13} />
          <input
            aria-label="Search assets"
            placeholder="Search assets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="secondary-button" onClick={onImport}>
          <Upload size={13} /> Import assets
        </button>
      </div>
      <div className="asset-body">
        <nav className="asset-categories">
          {categories.map((c, i) => (
            <button
              key={c}
              className={c === category ? 'selected' : ''}
              onClick={() => setCategory(c)}
            >
              {
                [
                  <FolderOpen size={14} />,
                  <Box size={14} />,
                  <Boxes size={14} />,
                  <Image size={14} />,
                  <Sun size={14} />,
                ][i]
              }
              {c}
              {c === 'Primitives' && <span>6</span>}
            </button>
          ))}
        </nav>
        <div className="asset-grid">
          {primitives.map((kind) => (
            <button
              key={kind}
              className="asset-card"
              draggable
              onDragStart={(e) => drag(e, { kind })}
              onDoubleClick={() => s.add(kind)}
              title={`Drag ${labels[kind]} into the scene, or double-click to add`}
            >
              <div className={`asset-art primitive-${kind}`}>
                <Shape kind={kind} />
              </div>
              <span>{labels[kind]}</span>
              <small>PRIMITIVE</small>
            </button>
          ))}
          {assets.map((a) => (
            <button
              key={a.id}
              className="asset-card"
              draggable
              onDragStart={(e) => drag(e, { asset: a.id })}
              onDoubleClick={() => {
                if (a.type === 'model') {
                  const nodes = modelNodes(a);
                  s.commit((p) => p.nodes.push(...nodes));
                  s.select(nodes[0].id);
                } else if (a.type === 'environment')
                  s.commit((p) => {
                    p.environment.environmentId = a.id;
                  });
                else
                  notify('Drag this texture onto a mesh, or choose it in the material inspector.');
              }}
              title={a.name}
            >
              <div className="asset-art">
                {a.type === 'texture' || thumbnails.has(a.id) ? (
                  <img src={thumbnails.get(a.id) || assetUrl(a.id)} alt="" />
                ) : a.type === 'environment' ? (
                  <Globe2 size={38} />
                ) : (
                  <Boxes size={38} />
                )}
              </div>
              <span>{a.name}</span>
              <small>{a.type.toUpperCase()}</small>
            </button>
          ))}
          {lights
            .filter((k) => labels[k].toLowerCase().includes(query.toLowerCase()))
            .map((kind) => (
              <button
                key={kind}
                className="asset-card"
                draggable
                onDragStart={(e) => drag(e, { kind })}
                onDoubleClick={() => s.add(kind)}
              >
                <div className="asset-art light-art">
                  <Icon kind={kind} size={34} />
                </div>
                <span>{labels[kind]}</span>
                <small>{kind === 'camera' ? 'CAMERA' : 'LIGHT'}</small>
              </button>
            ))}
          {!primitives.length && !assets.length && !lights.length && (
            <div className="empty-state">
              <Upload size={22} />
              <span>
                {query
                  ? 'No matching assets'
                  : `Import ${category.toLowerCase()} to build your library`}
              </span>
              <button className="text-button" onClick={onImport}>
                Choose files
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function Shape({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 100 80" aria-hidden="true">
      <defs>
        <linearGradient id={`shade-${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b5bdc7" />
          <stop offset="1" stopColor="#5d6775" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="65" rx="27" ry="6" fill="#000" opacity=".2" />
      {kind === 'box' ? (
        <>
          <path d="M50 12 78 27 50 43 22 27Z" fill="#b0b8c3" />
          <path d="M22 27 50 43 50 70 22 53Z" fill="#7e8999" />
          <path d="M50 43 78 27 78 53 50 70Z" fill="#5e6979" />
        </>
      ) : kind === 'sphere' ? (
        <circle cx="50" cy="39" r="27" fill={`url(#shade-${kind})`} />
      ) : kind === 'plane' ? (
        <path d="M50 25 85 43 50 62 15 43Z" fill="#8996a6" />
      ) : kind === 'cylinder' ? (
        <>
          <path d="M26 24V58C26 73 74 73 74 58V24" fill={`url(#shade-${kind})`} />
          <ellipse cx="50" cy="24" rx="24" ry="11" fill="#b0b8c3" />
        </>
      ) : kind === 'cone' ? (
        <path d="M50 11 77 59C77 73 23 73 23 59Z" fill={`url(#shade-${kind})`} />
      ) : (
        <ellipse
          cx="50"
          cy="40"
          rx="26"
          ry="22"
          fill="none"
          stroke={`url(#shade-${kind})`}
          strokeWidth="12"
          transform="rotate(-25 50 40)"
        />
      )}
    </svg>
  );
}
export default function App() {
  const s = useStudio(),
    importInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false),
    [modal, setModal] = useState<'projects' | 'help' | null>(null),
    [saved, setSaved] = useState<SavedProject[]>([]),
    [addMenu, setAddMenu] = useState(false),
    [exportMenu, setExportMenu] = useState(false),
    [assetsOpen, setAssetsOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(false);
  const [left, setLeft] = useState(236),
    [right, setRight] = useState(280),
    [bottom, setBottom] = useState(220);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(async (label: string, work: () => Promise<void>) => {
    useStudio.setState({ busy: label });
    try {
      await work();
    } catch (e) {
      notify((e as Error).message || 'Something went wrong. Please try again.');
    } finally {
      useStudio.setState({ busy: '' });
    }
  }, []);
  const onFiles = useCallback(
    (files: File[]) => {
      void run('Importing assets…', async () => {
        const assets = await importFiles(files);
        useStudio.getState().commit((p) => {
          p.assets.push(...assets);
        });
        notify(
          `Imported ${assets.length} asset${assets.length === 1 ? '' : 's'}. Drag a model from the asset browser into your scene.`,
        );
      });
    },
    [run],
  );
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const p = await lastProject();
        if (mounted && p) useStudio.getState().replace(p);
      } catch (e) {
        notify(`Local recovery: ${(e as Error).message}`);
      } finally {
        if (mounted) {
          setReady(true);
          useStudio.setState({ status: 'Ready' });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const persist = useCallback(async (p: Project) => {
    const task = saving.current.catch(() => {}).then(() => saveProject(p));
    saving.current = task;
    await task;
    if (useStudio.getState().project === p) useStudio.setState({ status: 'All changes saved' });
  }, []);
  useEffect(() => {
    if (!ready) return;
    const p = s.project;
    const timer = setTimeout(() => {
      useStudio.setState({ status: 'Saving…' });
      void persist(p).catch((e) => {
        useStudio.setState({ status: 'Local save failed' });
        notify(`Could not save locally: ${e.message}. Download a project backup.`);
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [s.project, ready, persist]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (
        ['Unsaved changes', 'Saving…', 'Local save failed'].includes(useStudio.getState().status)
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    if (!ready || s.busy) return;
    const projects = [s.project, ...s.past, ...s.future];
    pruneAssets(new Set(projects.flatMap((p) => p.assets.map((a) => a.id))));
  }, [s.project, s.past, s.future, s.busy, ready]);
  const backup = useCallback(() => {
    void run('Packing project…', async () => {
      await exportProject(useStudio.getState().project);
      notify('Project downloaded with all imported assets.');
    });
  }, [run]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      const state = useStudio.getState(),
        modifier = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        useStudio.setState({ preview: false });
        setModal(null);
        setAddMenu(false);
        setExportMenu(false);
        return;
      }
      if (state.busy || modal || !ready) return;
      if (modifier && e.key.toLowerCase() === 's') {
        e.preventDefault();
        backup();
        return;
      }
      if (state.preview) return;
      if (modifier && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? state.redo() : state.undo();
      } else if (modifier && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
      } else if (modifier && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        state.duplicate();
      } else if (modifier && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        state.group();
      } else if (modifier && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        useStudio.setState({
          selected: state.project.nodes
            .filter((n) => !isLocked(state.project.nodes, n.id))
            .map((n) => n.id),
        });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        state.remove();
      } else if (!modifier) {
        const k = e.key.toLowerCase();
        if (k === 'w') useStudio.setState({ tool: 'translate' });
        if (k === 'e') useStudio.setState({ tool: 'rotate' });
        if (k === 'r') useStudio.setState({ tool: 'scale' });
        if (k === 'f') useStudio.setState({ focus: state.focus + 1 });
        if (k === 'g') useStudio.setState({ grid: !state.grid });
        if (k === 'x') useStudio.setState({ snap: !state.snap });
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [backup, modal, ready]);
  useEffect(() => {
    if (!s.notice) return;
    const timer = setTimeout(() => useStudio.setState({ notice: '' }), 10000);
    return () => clearTimeout(timer);
  }, [s.notice]);
  function resize(e: React.PointerEvent, side: 'left' | 'right' | 'bottom') {
    e.preventDefault();
    const start = side === 'bottom' ? e.clientY : e.clientX,
      initial = side === 'left' ? left : side === 'right' ? right : bottom;
    const move = (event: PointerEvent) => {
      const delta = (side === 'bottom' ? event.clientY : event.clientX) - start;
      const value = initial + (side === 'left' ? delta : -delta);
      if (side === 'left') setLeft(Math.min(380, Math.max(180, value)));
      if (side === 'right') setRight(Math.min(400, Math.max(240, value)));
      if (side === 'bottom') setBottom(Math.min(window.innerHeight * 0.5, Math.max(160, value)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  async function showProjects() {
    await run('Loading projects…', async () => {
      await persist(useStudio.getState().project);
      setSaved(await listProjects());
      setModal('projects');
    });
  }
  function create(demo: boolean) {
    void run('Creating project…', async () => {
      await persist(useStudio.getState().project);
      useStudio.getState().replace(newProject(demo));
      setModal(null);
    });
  }
  return (
    <div
      className="studio"
      style={
        {
          '--left-width': `${left}px`,
          '--right-width': `${right}px`,
          '--asset-height': assetsOpen ? `${bottom}px` : '0px',
        } as CSSProperties
      }
    >
      <header className="main-header">
        <a className="brand" href="./" aria-label="Forma Studio">
          <div className="brand-mark">
            <Layers size={21} />
          </div>
          <span>
            forma<span className="brand-dot">.</span>
          </span>
          <small>STUDIO</small>
        </a>
        <div className="header-divider" />
        <button className="menu-button" onClick={() => void showProjects()}>
          File <ChevronDown size={11} />
        </button>
        <button className="menu-button" onClick={() => setModal('help')}>
          Help <ChevronDown size={11} />
        </button>
        <div className="project-title">
          <span className="project-dot" />
          <TextField
            label="Project name"
            value={s.project.name}
            onChange={(name) =>
              s.commit((p) => {
                p.name = name;
              })
            }
          />
          <span className="project-tag">LOCAL</span>
        </div>
        <span className="save-status">
          {s.status === 'All changes saved' ? <Check size={12} /> : <Save size={12} />}
          <span>{s.status}</span>
        </span>
        <button className="header-projects" onClick={() => void showProjects()}>
          <FolderOpen size={14} /> Projects
        </button>
        <div className="export-wrap">
          <button className="primary-button" onClick={() => setExportMenu(!exportMenu)}>
            <Download size={14} /> Export <ChevronDown size={12} />
          </button>
          {exportMenu && (
            <div className="dropdown export-dropdown">
              <button
                onClick={() => {
                  backup();
                  setExportMenu(false);
                }}
              >
                <Save size={14} />
                <span>
                  Download project<small>Editable scene + all assets</small>
                </span>
              </button>
              <button
                onClick={() => {
                  void run('Exporting GLB…', async () => {
                    if (!viewportActions.exportGLB) throw new Error('The viewport is not ready.');
                    await viewportActions.exportGLB();
                  });
                  setExportMenu(false);
                }}
              >
                <Box size={14} />
                <span>
                  Export scene as GLB<small>Standard 3D model format</small>
                </span>
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="toolbar">
        <div className="add-wrap">
          <button className="add-button" onClick={() => setAddMenu(!addMenu)} disabled={s.preview}>
            <Plus size={15} /> Add object <ChevronDown size={12} />
          </button>
          {addMenu && (
            <div className="dropdown add-dropdown">
              {(
                [
                  ...primitiveKinds,
                  'group',
                  'camera',
                  'directional',
                  'point',
                  'spot',
                  'ambient',
                  'hemisphere',
                ] as Kind[]
              ).map((kind) => (
                <button
                  key={kind}
                  onClick={() => {
                    s.add(kind);
                    setAddMenu(false);
                  }}
                >
                  <Icon kind={kind} />
                  {labels[kind]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group">
          <Button
            title="Move (W)"
            active={s.tool === 'translate'}
            onClick={() => useStudio.setState({ tool: 'translate' })}
            disabled={s.preview}
          >
            <Move3D size={17} />
          </Button>
          <Button
            title="Rotate (E)"
            active={s.tool === 'rotate'}
            onClick={() => useStudio.setState({ tool: 'rotate' })}
            disabled={s.preview}
          >
            <Rotate3D size={17} />
          </Button>
          <Button
            title="Scale (R)"
            active={s.tool === 'scale'}
            onClick={() => useStudio.setState({ tool: 'scale' })}
            disabled={s.preview}
          >
            <Scaling size={17} />
          </Button>
        </div>
        <div className="toolbar-divider" />
        <button
          className="space-button"
          onClick={() => useStudio.setState({ space: s.space === 'world' ? 'local' : 'world' })}
        >
          <Globe2 size={13} />
          {s.space === 'world' ? 'World' : 'Local'}
          <ChevronDown size={11} />
        </button>
        <Button
          title="Toggle snapping (X)"
          active={s.snap}
          onClick={() => useStudio.setState({ snap: !s.snap })}
        >
          <Magnet size={16} />
        </Button>
        <Button
          title="Toggle grid (G)"
          active={s.grid}
          onClick={() => useStudio.setState({ grid: !s.grid })}
        >
          <Grid2X2 size={16} />
        </Button>
        <div className="toolbar-divider" />
        <Button title="Undo (Ctrl/⌘ Z)" onClick={s.undo} disabled={!s.past.length || s.preview}>
          <Undo2 size={16} />
        </Button>
        <Button
          title="Redo (Ctrl/⌘ Shift Z)"
          onClick={s.redo}
          disabled={!s.future.length || s.preview}
        >
          <Redo2 size={16} />
        </Button>
        <div className="toolbar-spacer" />
        <button
          className={`preview-button ${s.preview ? 'active' : ''}`}
          onClick={() => useStudio.setState({ preview: !s.preview })}
        >
          {s.preview ? <Square size={13} /> : <Play size={13} />}{' '}
          {s.preview ? 'Stop preview' : 'Preview'}
        </button>
        <div className="toolbar-spacer" />
        <Button
          title="Focus selection (F)"
          onClick={() => useStudio.setState({ focus: s.focus + 1 })}
        >
          <Focus size={16} />
        </Button>
        <Button
          title="Toggle orthographic view"
          active={s.orthographic}
          onClick={() => useStudio.setState({ orthographic: !s.orthographic })}
        >
          <Maximize size={16} />
        </Button>
        <Button
          title="Toggle asset browser"
          active={assetsOpen}
          onClick={() => setAssetsOpen(!assetsOpen)}
        >
          <PanelBottom size={16} />
        </Button>
        <button
          className="agent-toggle"
          aria-expanded={agentOpen}
          onClick={() => setAgentOpen(!agentOpen)}
        >
          Agent
        </button>
      </div>
      <main className="workspace">
        <Hierarchy />
        <div className="resize-handle left-handle" onPointerDown={(e) => resize(e, 'left')} />
        <div className="center-workspace">
          <Viewport onFiles={onFiles} />
          {assetsOpen && (
            <>
              <div
                className="resize-handle bottom-handle"
                onPointerDown={(e) => resize(e, 'bottom')}
              />
              <AssetBrowser onImport={() => importInput.current?.click()} />
            </>
          )}
        </div>
        <div className="resize-handle right-handle" onPointerDown={(e) => resize(e, 'right')} />
        {!agentOpen && <Inspector />}
        <AgentPanel
          open={agentOpen}
          close={() => setAgentOpen(false)}
          ready={ready}
          persist={persist}
        />
      </main>
      <footer className="status-bar">
        <WebMCPBridge ready={ready} persist={persist} />
        <span>
          <span className="live-dot" /> WebGL renderer
        </span>
        <span>{s.project.nodes.length} objects</span>
        <span>{s.project.assets.length} assets</span>
        <div className="toolbar-spacer" />
        <span>1 unit = 1 meter</span>
        <span>Three.js Studio</span>
        <button onClick={() => setModal('help')}>
          <CircleHelp size={12} /> Shortcuts
        </button>
      </footer>
      <input
        ref={importInput}
        hidden
        type="file"
        multiple
        accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.hdr"
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        hidden
        type="file"
        accept=".threejsstudio,.zip"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void run('Opening project…', async () => {
              await persist(useStudio.getState().project);
              const p = await openProject(file);
              useStudio.getState().replace(p);
              setModal(null);
            });
          e.target.value = '';
        }}
      />
      {s.notice && (
        <div className="toast" role="status">
          <span>{s.notice}</span>
          <Button title="Dismiss notification" onClick={() => useStudio.setState({ notice: '' })}>
            <X size={15} />
          </Button>
        </div>
      )}
      {(s.busy || !ready) && (
        <div className="busy-overlay">
          <div>
            <LoaderCircle size={20} className="spinner" />
            {s.busy || 'Opening your studio…'}
          </div>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'help' ? 'Studio shortcuts' : 'Projects'}
          >
            <div className="modal-heading">
              <div>
                <small>FORMA STUDIO</small>
                <h2>
                  {modal === 'help' ? 'Make yourself at home.' : 'Your worlds, in one place.'}
                </h2>
              </div>
              <Button title="Close dialog" onClick={() => setModal(null)}>
                <X size={18} />
              </Button>
            </div>
            {modal === 'help' ? (
              <>
                <p className="modal-description">A few shortcuts to keep you in the flow.</p>
                <div className="shortcut-list">
                  {[
                    ['Move / Rotate / Scale', 'W / E / R'],
                    ['Focus selected objects', 'F'],
                    ['Add to selection', 'Shift + click'],
                    ['Undo / Redo', '⌘ Ctrl + Z / Shift Z'],
                    ['Duplicate / Group', '⌘ Ctrl + D / G'],
                    ['Select all', '⌘ Ctrl + A'],
                    ['Delete objects', 'Delete / Backspace'],
                    ['Grid / Snapping', 'G / X'],
                    ['Download project', '⌘ Ctrl + S'],
                    ['Exit preview', 'Escape'],
                    ['Orbit / Pan / Zoom', 'Drag / Right-drag / Scroll'],
                  ].map(([label, key]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <p className="modal-description">
                  Drag shapes and models into the viewport. Drag hierarchy rows to parent objects.
                  Double-click a hierarchy row to focus it. Projects autosave in this browser;
                  download backups before clearing browser data.
                </p>
              </>
            ) : (
              <>
                <p className="modal-description">
                  Saved in this browser. Download a project to keep a portable backup.
                </p>
                <div className="project-actions">
                  <button className="secondary-button" onClick={() => create(false)}>
                    <FilePlus2 size={16} /> Empty world
                  </button>
                  <button className="secondary-button" onClick={() => create(true)}>
                    <Boxes size={16} /> Sample garden
                  </button>
                  <button className="primary-button" onClick={() => projectInput.current?.click()}>
                    <Upload size={15} /> Open project file
                  </button>
                </div>
                <div className="project-list">
                  {saved.map((entry) => (
                    <div key={entry.project.id} className="saved-project">
                      <div className="saved-project-icon">
                        <Globe2 size={23} />
                      </div>
                      <button
                        onClick={() =>
                          void run('Opening world…', async () => {
                            const p = await loadProject(entry.project.id);
                            useStudio.getState().replace(p);
                            setModal(null);
                          })
                        }
                      >
                        <strong>{entry.project.name}</strong>
                        <span>
                          {entry.project.nodes.length} objects ·{' '}
                          {new Date(entry.updated).toLocaleString()}
                        </span>
                      </button>
                      {entry.project.id === s.project.id && <small>OPEN</small>}
                      <Button
                        title={`Delete ${entry.project.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete “${entry.project.name}” from this browser? Downloaded backups will not be affected.`,
                            )
                          )
                            void run('Deleting project…', async () => {
                              await deleteProject(entry.project.id);
                              if (entry.project.id === useStudio.getState().project.id)
                                useStudio.getState().replace(newProject());
                              setSaved(await listProjects());
                            });
                        }}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
