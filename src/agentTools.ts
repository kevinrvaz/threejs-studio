import { z } from 'zod';
import { Mesh, MeshStandardMaterial } from 'three';
import { useStudio } from './store';
import {
  isLocked,
  material,
  newProject,
  node,
  primitiveKinds,
  reparent,
  validateProject,
  worldMatrix,
} from './model';
import type { Project, SceneNode, Vec3 } from './model';
import {
  exportProject,
  importFiles,
  listProjects,
  loadProject,
  modelNodes,
  modelPart,
  openProject,
} from './assets';
import { viewportActions } from './Viewport';

export interface AgentBridge {
  persist: (project: Project) => Promise<void>;
  flushUI?: () => void;
}
interface Execution {
  signal: AbortSignal;
}
export interface AgentResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown, options: Execution) => Promise<AgentResult>;
}
const vector = z.array(z.number().finite()).length(3);
const name = z.string().trim().min(1).max(200);
const id = z.string().min(1).max(200);
const ids = z.array(id).min(1).max(200);
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex color, such as #aabbcc.');
const fraction = z.number().finite().min(0).max(1);
const materialSchema = z.strictObject({
  color: color.optional(),
  roughness: fraction.optional(),
  metalness: fraction.optional(),
  opacity: fraction.optional(),
  texture: z.string().max(200).optional(),
});
const transform = {
  position: vector.describe('Local position in meters.').optional(),
  rotation: vector.describe('Local Euler XYZ rotation in degrees.').optional(),
  scale: vector
    .refine((v) => v.every((n) => Math.abs(n) >= 0.0001), 'Every scale component must be nonzero.')
    .describe('Local scale along each axis.')
    .optional(),
};
const kind = z.enum([
  ...primitiveKinds,
  'group',
  'camera',
  'ambient',
  'hemisphere',
  'directional',
  'point',
  'spot',
]);
const lightSchema = z.strictObject({ color, intensity: z.number().finite().min(0).max(100000) });
const objectSettings = {
  name: name.optional(),
  ...transform,
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  material: materialSchema.optional(),
  light: lightSchema.optional(),
  fov: z.number().finite().min(1).max(179).optional(),
};
const uploadedFile = z.strictObject({
  name: name.describe('Filename including its extension.'),
  base64: z
    .string()
    .min(1)
    .max(24_000_000)
    .describe('Base64-encoded file bytes, without a data-URL prefix. Maximum 16 MiB per file.'),
});
function filesFromInput(input: z.infer<typeof uploadedFile>[]) {
  let total = 0;
  return input.map((f) => {
    let decoded: string;
    try {
      decoded = atob(f.base64);
    } catch {
      throw new Error(`Invalid base64 for ${f.name}.`);
    }
    total += decoded.length;
    if (decoded.length > 16 * 1024 * 1024 || total > 32 * 1024 * 1024)
      throw new Error(
        'Agent imports support 16 MiB per file and 32 MiB total. Use the UI for larger files.',
      );
    return new File([Uint8Array.from(decoded, (c) => c.charCodeAt(0))], f.name);
  });
}
function requireNodes(selected: string[], editable = false) {
  const p = useStudio.getState().project;
  for (const nodeId of selected) {
    if (!p.nodes.some((n) => n.id === nodeId))
      throw new Error(`Object not found: ${nodeId}. Refresh studio_get_scene for current IDs.`);
    if (editable && isLocked(p.nodes, nodeId))
      throw new Error(`Object ${nodeId} is locked. Unlock it or its parent before editing.`);
  }
}
function commit(fn: (p: Project) => void) {
  useStudio.getState().commit((p) => {
    fn(p);
    validateProject(p);
  });
}
function snapshot() {
  const s = useStudio.getState();
  return {
    project: structuredClone(s.project),
    revision: s.revision,
    selectedIds: [...s.selected],
    canUndo: !!s.past.length,
    canRedo: !!s.future.length,
    saveStatus: s.status,
    view: {
      tool: s.tool,
      space: s.space,
      snap: s.snap,
      snapMove: s.snapMove,
      snapAngle: s.snapAngle,
      snapScale: s.snapScale,
      grid: s.grid,
      orthographic: s.orthographic,
      preview: s.preview,
    },
    worldMatrices: Object.fromEntries(
      s.project.nodes.map((n) => [n.id, worldMatrix(s.project.nodes, n.id).toArray()]),
    ),
  };
}
function effectiveMaterial(n: SceneNode) {
  if (n.material) return n.material;
  const part = n.assetId ? modelPart(n.assetId, n.sourcePath) : null;
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
function assertMaterial(n: SceneNode) {
  if (
    !primitiveKinds.includes(n.kind as (typeof primitiveKinds)[number]) &&
    !(n.assetId && modelPart(n.assetId, n.sourcePath) instanceof Mesh)
  )
    throw new Error(
      `Object ${n.name} is not a mesh. Select one of its mesh children to edit a material.`,
    );
}
export function buildAgentTools(bridge: AgentBridge): AgentTool[] {
  function define<T extends z.ZodType>(
    toolName: string,
    description: string,
    schema: T,
    readOnly: boolean,
    execute: (input: z.infer<T>, options: Execution) => unknown | Promise<unknown>,
  ): AgentTool {
    return {
      name: `studio_${toolName}`,
      description,
      inputSchema: z.toJSONSchema(schema),
      annotations: { readOnlyHint: readOnly, untrustedContentHint: true },
      async execute(input, options) {
        let ownsBusy = false;
        try {
          options.signal.throwIfAborted();
          const parsed = schema.parse(input);
          if (!readOnly) {
            if (useStudio.getState().busy)
              throw new Error(
                'The editor is busy. Wait for the current operation to finish and retry.',
              );
            useStudio.setState({ busy: `Agent: ${toolName.replaceAll('_', ' ')}…` });
            ownsBusy = true;
          }
          const value = await execute(parsed, options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  result: value,
                  revision: useStudio.getState().revision,
                }),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof z.ZodError
              ? error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
              : error instanceof Error
                ? error.message
                : String(error);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: false,
                  error: message,
                  revision: useStudio.getState().revision,
                }),
              },
            ],
          };
        } finally {
          if (ownsBusy) useStudio.setState({ busy: '' });
          bridge.flushUI?.();
        }
      },
    };
  }
  return [
    define(
      'get_scene',
      'Inspect the active scene, stable object IDs, hierarchy, local transforms, world matrices, selection, editor settings, and undo availability.',
      z.strictObject({}),
      true,
      () => snapshot(),
    ),
    define(
      'list_assets',
      'Inspect the reusable models, textures, and HDR environments already imported into this project.',
      z.strictObject({}),
      true,
      () => structuredClone(useStudio.getState().project.assets),
    ),
    define(
      'create_objects',
      'Create primitives, groups, lights, or cameras in one undoable operation. Returns created IDs for subsequent editing and parenting.',
      z.strictObject({
        objects: z
          .array(
            z.strictObject({
              kind,
              ...objectSettings,
              parentId: id
                .nullable()
                .optional()
                .describe('An existing parent object; omitted means scene root.'),
            }),
          )
          .min(1)
          .max(200),
      }),
      false,
      ({ objects }) => {
        const created = objects.map(({ kind, parentId, material: m, ...settings }) => {
          if (parentId) requireNodes([parentId], true);
          const n = node(kind, {
            ...settings,
            position: settings.position as Vec3 | undefined,
            rotation: settings.rotation as Vec3 | undefined,
            scale: settings.scale as Vec3 | undefined,
            parent: parentId || null,
          });
          // Omitted optional fields preserve primitive-specific defaults.
          const defaults = node(kind);
          for (const key of ['position', 'rotation', 'scale'] as const)
            if (!n[key]) n[key] = defaults[key];
          if (m) {
            assertMaterial(n);
            n.material = { ...effectiveMaterial(n), ...m };
          }
          return n;
        });
        commit((p) => {
          p.nodes.push(...created);
          if (!p.previewCamera)
            p.previewCamera = created.find((n) => n.kind === 'camera')?.id || null;
        });
        useStudio.setState({ selected: created.map((n) => n.id) });
        return created;
      },
    ),
    define(
      'instantiate_asset',
      'Place an imported model in the scene, preserving its editable child hierarchy. Returns the new root and child IDs.',
      z.strictObject({
        assetId: id.describe('Model ID from studio_list_assets.'),
        position: vector.optional().describe('World placement in meters.'),
        parentId: id.optional().describe('Optional existing parent; world placement is preserved.'),
      }),
      false,
      ({ assetId, position, parentId }) => {
        const a = useStudio.getState().project.assets.find((a) => a.id === assetId);
        if (!a || a.type !== 'model') throw new Error('Choose an existing model asset ID.');
        if (parentId) requireNodes([parentId], true);
        const nodes = modelNodes(a, (position || [0, 0, 0]) as Vec3);
        commit((p) => {
          p.nodes.push(...nodes);
          if (parentId) p.nodes = reparent(p, [nodes[0].id], parentId).nodes;
        });
        useStudio.setState({ selected: [nodes[0].id] });
        return { rootId: nodes[0].id, nodeIds: nodes.map((n) => n.id) };
      },
    ),
    define(
      'update_objects',
      'Apply object names, local transforms, materials, visibility, locks, light settings, or camera properties as one undoable edit. Material fields merge with existing settings.',
      z.strictObject({
        updates: z
          .array(z.strictObject({ id, changes: z.strictObject(objectSettings) }))
          .min(1)
          .max(200),
      }),
      false,
      ({ updates }) => {
        requireNodes(updates.map((u) => u.id));
        commit((p) => {
          for (const { id: objectId, changes } of updates) {
            const n = p.nodes.find((n) => n.id === objectId)!;
            const onlyUnlock = Object.keys(changes).length === 1 && changes.locked === false;
            if (
              isLocked(p.nodes, objectId) &&
              !(onlyUnlock && (!n.parent || !isLocked(p.nodes, n.parent)))
            )
              throw new Error(`Object ${n.name} is locked; unlock its parent first if necessary.`);
            const { material: m, ...rest } = changes;
            if (changes.light && !n.light) throw new Error(`${n.name} is not an editable light.`);
            if (changes.fov !== undefined && n.kind !== 'camera')
              throw new Error(`${n.name} is not a camera.`);
            if (m) {
              assertMaterial(n);
              if (m.texture && !p.assets.some((a) => a.id === m.texture && a.type === 'texture'))
                throw new Error('Choose an existing texture asset ID.');
              n.material = { ...effectiveMaterial(n), ...m };
            }
            Object.assign(n, rest);
          }
        });
        return { updatedIds: updates.map((u) => u.id) };
      },
    ),
    define(
      'select_objects',
      'Select scene objects in the UI and optionally frame them in the viewport. An empty selection clears the inspector.',
      z.strictObject({ ids: z.array(id).max(200), focus: z.boolean().default(false) }),
      false,
      ({ ids, focus }) => {
        requireNodes(ids);
        const s = useStudio.getState();
        useStudio.setState({ selected: [...new Set(ids)], focus: s.focus + (focus ? 1 : 0) });
        return { selectedIds: ids };
      },
    ),
    define(
      'organize_objects',
      'Group, duplicate, reparent, or remove scene objects and their children through the editor command system. Each action supports undo.',
      z.strictObject({
        action: z.enum(['group', 'duplicate', 'reparent', 'delete']),
        ids,
        parentId: id
          .nullable()
          .optional()
          .describe('Destination for reparent; null moves objects to the scene root.'),
      }),
      false,
      ({ action, ids, parentId }) => {
        requireNodes(ids, true);
        const s = useStudio.getState();
        if (action === 'reparent') {
          if (parentId === undefined)
            throw new Error('Provide parentId for reparent, or null for the scene root.');
          if (parentId) requireNodes([parentId], true);
          reparent(s.project, ids, parentId);
        }
        useStudio.setState({ selected: ids });
        const revision = s.revision;
        if (action === 'group') s.group();
        else if (action === 'duplicate') s.duplicate();
        else if (action === 'delete') s.remove();
        else s.parent(ids, parentId!);
        if (action === 'group' && useStudio.getState().revision === revision)
          throw new Error(useStudio.getState().notice || 'Could not group these objects.');
        return {
          selectedIds: useStudio.getState().selected,
          objectCount: useStudio.getState().project.nodes.length,
        };
      },
    ),
    define(
      'history',
      'Undo or redo the last committed scene edit, including edits made by either the user or an agent.',
      z.strictObject({ action: z.enum(['undo', 'redo']) }),
      false,
      ({ action }) => {
        const s = useStudio.getState();
        if (!(action === 'undo' ? s.past.length : s.future.length))
          throw new Error(`Nothing to ${action}.`);
        s[action]();
        return snapshot();
      },
    ),
    define(
      'update_project',
      'Rename the current world, adjust background, exposure and fog, choose HDR lighting, or select the preview camera.',
      z.strictObject({
        name: name.optional(),
        environment: z
          .strictObject({
            background: color.optional(),
            exposure: z.number().finite().min(0).max(10).optional(),
            fog: z.boolean().optional(),
            fogDensity: fraction.optional(),
            environmentId: id
              .nullable()
              .optional()
              .describe('HDR asset ID, or null to clear image-based lighting.'),
          })
          .optional(),
        previewCamera: id
          .nullable()
          .optional()
          .describe('Scene camera ID, or null to preview the editor viewpoint.'),
      }),
      false,
      ({ name, environment, previewCamera }) => {
        commit((p) => {
          if (name) p.name = name;
          if (previewCamera !== undefined) p.previewCamera = previewCamera;
          if (environment) {
            if (
              environment.environmentId &&
              !p.assets.some((a) => a.id === environment.environmentId && a.type === 'environment')
            )
              throw new Error('Choose an imported HDR environment asset.');
            Object.assign(
              p.environment,
              environment,
              environment.environmentId === null ? { environmentId: undefined } : {},
            );
          }
        });
        return {
          name: useStudio.getState().project.name,
          environment: useStudio.getState().project.environment,
          previewCamera: useStudio.getState().project.previewCamera,
        };
      },
    ),
    define(
      'set_view',
      'Change visible editor controls, projection, snapping, and preview mode. Optionally focus the current selection.',
      z.strictObject({
        tool: z.enum(['translate', 'rotate', 'scale']).optional(),
        space: z.enum(['world', 'local']).optional(),
        snap: z.boolean().optional(),
        snapMove: z.number().finite().min(0.001).optional(),
        snapAngle: z.number().finite().min(1).max(180).optional(),
        snapScale: z.number().finite().min(0.01).optional(),
        grid: z.boolean().optional(),
        orthographic: z.boolean().optional(),
        preview: z.boolean().optional(),
        focus: z.boolean().optional(),
      }),
      false,
      ({ focus, ...settings }) => {
        useStudio.setState({
          ...settings,
          ...(focus ? { focus: useStudio.getState().focus + 1 } : {}),
        });
        return snapshot().view;
      },
    ),
    define(
      'align_camera',
      'Align a scene camera to the current editor viewpoint and optionally make it the preview camera.',
      z.strictObject({ id, useForPreview: z.boolean().default(true) }),
      false,
      ({ id, useForPreview }) => {
        requireNodes([id], true);
        if (useStudio.getState().project.nodes.find((n) => n.id === id)!.kind !== 'camera')
          throw new Error('Choose a camera object.');
        if (!viewportActions.alignCamera) throw new Error('The viewport is not ready.');
        viewportActions.alignCamera(id);
        if (useForPreview)
          commit((p) => {
            p.previewCamera = id;
          });
        return useStudio.getState().project.nodes.find((n) => n.id === id);
      },
    ),
    define(
      'import_assets',
      'Import provided GLB/glTF models, companion buffers and images, textures, or HDR environments into the asset browser. Imported models can then be instantiated into the scene.',
      z.strictObject({ files: z.array(uploadedFile).min(1).max(30) }),
      false,
      async ({ files }, { signal }) => {
        const assets = await importFiles(filesFromInput(files));
        signal.throwIfAborted();
        commit((p) => p.assets.push(...assets));
        return assets;
      },
    ),
    define(
      'save_project',
      'Save the active project and assets to browser storage. Optionally also download a portable project archive.',
      z.strictObject({ download: z.boolean().default(false) }),
      false,
      async ({ download }, { signal }) => {
        const p = useStudio.getState().project;
        await bridge.persist(p);
        signal.throwIfAborted();
        if (download) await exportProject(p);
        return { projectId: p.id, saved: true, downloaded: download };
      },
    ),
    define(
      'export_glb',
      'Download the visible environment as a GLB file for other 3D tools. Background, fog, HDR lighting, and editor state remain in the studio project.',
      z.strictObject({}),
      false,
      async (_, { signal }) => {
        signal.throwIfAborted();
        if (!viewportActions.exportGLB) throw new Error('The WebGL viewport is not ready.');
        await viewportActions.exportGLB();
        return { downloaded: true, format: 'glb' };
      },
    ),
    define(
      'list_projects',
      'List projects saved in this browser by ID, name, object count, and modification time.',
      z.strictObject({}),
      true,
      async () =>
        (await listProjects()).map((p) => ({
          id: p.project.id,
          name: p.project.name,
          objectCount: p.project.nodes.length,
          updated: p.updated,
        })),
    ),
    define(
      'open_saved_project',
      'Save the current world, then open a project from browser storage. Opening a project resets the editor undo history.',
      z.strictObject({ projectId: id }),
      false,
      async ({ projectId }, { signal }) => {
        await bridge.persist(useStudio.getState().project);
        signal.throwIfAborted();
        const project = await loadProject(projectId);
        useStudio.getState().replace(project);
        return { projectId: project.id, name: project.name };
      },
    ),
    define(
      'open_project_archive',
      'Save the current world, validate a supplied portable archive with its assets, then open it as the active project.',
      z.strictObject({ file: uploadedFile }),
      false,
      async ({ file }, { signal }) => {
        const [archive] = filesFromInput([file]);
        await bridge.persist(useStudio.getState().project);
        signal.throwIfAborted();
        const p = await openProject(archive);
        useStudio.getState().replace(p);
        return { projectId: p.id, name: p.name };
      },
    ),
    define(
      'new_project',
      'Save the current world and create a separate empty environment or sample garden. Previously saved projects remain available.',
      z.strictObject({ name: name.optional(), sample: z.boolean().default(false) }),
      false,
      async ({ name, sample }, { signal }) => {
        await bridge.persist(useStudio.getState().project);
        signal.throwIfAborted();
        const p = newProject(sample);
        if (name) p.name = name;
        useStudio.getState().replace(p);
        return { projectId: p.id, name: p.name };
      },
    ),
  ];
}
