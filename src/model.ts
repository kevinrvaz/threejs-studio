import { Matrix4, Quaternion, Euler, Vector3 } from 'three';
export type Vec3 = [number, number, number];
export const primitiveKinds = ['box', 'sphere', 'plane', 'cylinder', 'cone', 'torus'] as const;
export type Kind =
  | (typeof primitiveKinds)[number]
  | 'group'
  | 'model'
  | 'ambient'
  | 'hemisphere'
  | 'directional'
  | 'point'
  | 'spot'
  | 'camera';
export interface Material {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  texture?: string;
}
export interface SceneNode {
  id: string;
  name: string;
  kind: Kind;
  parent: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  material?: Material;
  assetId?: string;
  sourcePath?: string;
  light?: { color: string; intensity: number };
  fov?: number;
}
export interface Asset {
  id: string;
  name: string;
  type: 'model' | 'texture' | 'environment';
  file: string;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  nodes: SceneNode[];
  assets: Asset[];
  environment: {
    background: string;
    exposure: number;
    fog: boolean;
    fogDensity: number;
    environmentId?: string;
  };
  previewCamera: string | null;
}
export const uid = () => crypto.randomUUID();
export const material = (color = '#b6bdc9'): Material => ({
  color,
  roughness: 0.55,
  metalness: 0.05,
  opacity: 1,
});
export function node(kind: Kind, options: Partial<SceneNode> = {}): SceneNode {
  return {
    id: uid(),
    name: kind[0].toUpperCase() + kind.slice(1),
    kind,
    parent: null,
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    castShadow: true,
    receiveShadow: true,
    ...(primitiveKinds.includes(kind as (typeof primitiveKinds)[number])
      ? { material: material() }
      : {}),
    ...(['ambient', 'hemisphere', 'directional', 'point', 'spot'].includes(kind)
      ? {
          light: { color: '#ffffff', intensity: kind === 'ambient' ? 0.5 : 2 },
          position: [3, 5, 3] as Vec3,
        }
      : {}),
    ...(kind === 'camera'
      ? { fov: 50, position: [6, 4, 8] as Vec3, rotation: [-20, 35, 0] as Vec3 }
      : {}),
    ...(kind === 'plane' ? { rotation: [-90, 0, 0] as Vec3, position: [0, 0, 0] as Vec3 } : {}),
    ...options,
  };
}
export function newProject(demo = false): Project {
  const p: Project = {
    version: 1,
    id: uid(),
    name: demo ? 'Sculpture garden' : 'Untitled world',
    nodes: [],
    assets: [],
    environment: { background: '#252a34', exposure: 1.15, fog: false, fogDensity: 0.025 },
    previewCamera: null,
  };
  p.nodes.push(
    node('hemisphere', { name: 'Sky light', light: { color: '#dbe7ff', intensity: 2 } }),
    node('directional', {
      name: 'Sun',
      position: [4, 8, 5],
      light: { color: '#fff1df', intensity: 3 },
    }),
  );
  if (!demo) return p;
  const group = node('group', { name: 'Sculpture collection', position: [0, 0, 0] });
  p.nodes.push(
    node('box', {
      name: 'Foundation',
      position: [0, -0.2, 0],
      scale: [9, 0.4, 7],
      material: material('#727f86'),
    }),
    group,
    node('cylinder', {
      name: 'Round plinth',
      position: [-1.7, 0.35, 0],
      scale: [1.7, 0.7, 1.7],
      material: material('#cfccc0'),
      parent: group.id,
    }),
    node('torus', {
      name: 'Orbit sculpture',
      position: [-1.7, 1.65, 0],
      rotation: [0, -25, 0],
      scale: [1.15, 1.15, 1.15],
      material: { ...material('#c4dca1'), metalness: 0.28 },
      parent: group.id,
    }),
    node('box', {
      name: 'Tall plinth',
      position: [1.25, 0.65, -0.9],
      scale: [1.3, 1.3, 1.3],
      material: material('#cfccc0'),
      parent: group.id,
    }),
    node('sphere', {
      name: 'Coral sphere',
      position: [1.25, 1.95, -0.9],
      scale: [1.2, 1.2, 1.2],
      material: material('#d68e78'),
      parent: group.id,
    }),
    node('box', {
      name: 'Low plinth',
      position: [1.65, 0.2, 1.35],
      scale: [1.6, 0.4, 1.3],
      material: material('#cfccc0'),
      parent: group.id,
    }),
    node('cone', {
      name: 'Blue study',
      position: [1.65, 0.95, 1.35],
      scale: [1.2, 1.5, 1.2],
      material: material('#7a9cae'),
      parent: group.id,
    }),
  );
  const camera = node('camera', {
    name: 'Presentation camera',
    position: [10, 7, 12],
    rotation: [-24, 38, 0],
  });
  p.nodes.push(camera);
  p.previewCamera = camera.id;
  return p;
}
export function localMatrix(n: SceneNode) {
  return new Matrix4().compose(
    new Vector3(...n.position),
    new Quaternion().setFromEuler(
      new Euler(...(n.rotation.map((v) => (v * Math.PI) / 180) as Vec3)),
    ),
    new Vector3(...n.scale),
  );
}
export function worldMatrix(nodes: SceneNode[], id: string): Matrix4 {
  const n = nodes.find((n) => n.id === id);
  if (!n) return new Matrix4();
  return n.parent ? worldMatrix(nodes, n.parent).multiply(localMatrix(n)) : localMatrix(n);
}
export function transformFromMatrix(matrix: Matrix4) {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  matrix.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q);
  return {
    position: p.toArray() as Vec3,
    rotation: [e.x, e.y, e.z].map((v) => (v * 180) / Math.PI) as Vec3,
    scale: s.toArray() as Vec3,
  };
}
export function descendants(nodes: SceneNode[], ids: string[]): Set<string> {
  const all = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes)
      if (n.parent && all.has(n.parent) && !all.has(n.id)) {
        all.add(n.id);
        changed = true;
      }
  }
  return all;
}
export function selectionRoots(nodes: SceneNode[], ids: string[]) {
  return ids.filter((id) => {
    let n = nodes.find((n) => n.id === id);
    while (n?.parent) {
      if (ids.includes(n.parent)) return false;
      n = nodes.find((x) => x.id === n!.parent);
    }
    return true;
  });
}
export function isLocked(nodes: SceneNode[], id: string): boolean {
  const n = nodes.find((n) => n.id === id);
  return !!n && (n.locked || (!!n.parent && isLocked(nodes, n.parent)));
}
export function reparent(project: Project, ids: string[], parent: string | null): Project {
  const roots = selectionRoots(project.nodes, ids);
  const subtree = descendants(project.nodes, roots);
  if (parent && (subtree.has(parent) || !project.nodes.some((n) => n.id === parent)))
    throw new Error('An object cannot be parented to itself or its children.');
  const target = parent ? worldMatrix(project.nodes, parent) : new Matrix4();
  if (Math.abs(target.determinant()) < 1e-8)
    throw new Error('Cannot parent beneath an object with zero scale.');
  const result = structuredClone(project);
  for (const id of roots) {
    const n = result.nodes.find((n) => n.id === id)!;
    const matrix = target.clone().invert().multiply(worldMatrix(project.nodes, id));
    const transform = transformFromMatrix(matrix);
    const recomposed = localMatrix({ ...n, ...transform });
    if (matrix.elements.some((v, i) => Math.abs(v - recomposed.elements[i]) > 1e-5))
      throw new Error(
        'This parenting would shear the object. Use a parent with uniform scale to preserve its world transform.',
      );
    Object.assign(n, transform, { parent });
  }
  return result;
}
export function validateProject(value: unknown): Project {
  const p = value as Project;
  if (!p || p.version !== 1)
    throw new Error('Unsupported project version. This studio opens version 1 projects.');
  if (
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    !Array.isArray(p.nodes) ||
    !Array.isArray(p.assets) ||
    !p.environment
  )
    throw new Error('Invalid project document.');
  const ids = new Set(p.nodes.map((n) => n.id)),
    assets = new Set(p.assets.map((a) => a.id));
  const color = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (ids.size !== p.nodes.length || assets.size !== p.assets.length)
    throw new Error('Duplicate object or asset IDs.');
  for (const a of p.assets)
    if (
      typeof a.id !== 'string' ||
      typeof a.name !== 'string' ||
      !['model', 'texture', 'environment'].includes(a.type) ||
      typeof a.file !== 'string' ||
      a.file.includes('..') ||
      a.file.startsWith('/')
    )
      throw new Error('Invalid asset reference.');
  for (const n of p.nodes) {
    if (
      typeof n.id !== 'string' ||
      typeof n.name !== 'string' ||
      ![
        ...primitiveKinds,
        'group',
        'model',
        'ambient',
        'hemisphere',
        'directional',
        'point',
        'spot',
        'camera',
      ].includes(n.kind)
    )
      throw new Error('Invalid scene object.');
    if (
      ![n.position, n.rotation, n.scale].every(
        (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
      ) ||
      n.scale.some((v) => Math.abs(v) < 0.0001)
    )
      throw new Error('Invalid object transform. Scale must be nonzero.');
    if (n.parent !== null && !ids.has(n.parent)) throw new Error('Missing parent object.');
    for (const key of ['visible', 'locked', 'castShadow', 'receiveShadow'] as const)
      if (typeof n[key] !== 'boolean') throw new Error('Invalid object flags.');
    const seen = new Set([n.id]);
    let parent = n.parent;
    while (parent) {
      if (seen.has(parent)) throw new Error('Circular object hierarchy.');
      seen.add(parent);
      parent = p.nodes.find((x) => x.id === parent)!.parent;
    }
    if (n.assetId && !assets.has(n.assetId)) throw new Error('Missing model asset.');
    if (
      n.material &&
      (!color(n.material.color) ||
        ![n.material.roughness, n.material.metalness, n.material.opacity].every(
          (v) => Number.isFinite(v) && v >= 0 && v <= 1,
        ) ||
        (n.material.texture && !assets.has(n.material.texture)))
    )
      throw new Error('Invalid material.');
    if (
      n.light &&
      (!color(n.light.color) || !Number.isFinite(n.light.intensity) || n.light.intensity < 0)
    )
      throw new Error('Invalid light.');
    if (n.fov !== undefined && (!Number.isFinite(n.fov) || n.fov < 1 || n.fov > 179))
      throw new Error('Invalid camera.');
  }
  if (
    !color(p.environment.background) ||
    !Number.isFinite(p.environment.exposure) ||
    p.environment.exposure < 0 ||
    p.environment.exposure > 10 ||
    !Number.isFinite(p.environment.fogDensity) ||
    p.environment.fogDensity < 0 ||
    p.environment.fogDensity > 1 ||
    typeof p.environment.fog !== 'boolean' ||
    (p.environment.environmentId && !assets.has(p.environment.environmentId))
  )
    throw new Error('Invalid environment.');
  if (
    p.previewCamera !== null &&
    !p.nodes.some((n) => n.id === p.previewCamera && n.kind === 'camera')
  )
    throw new Error('Missing preview camera.');
  return p;
}
