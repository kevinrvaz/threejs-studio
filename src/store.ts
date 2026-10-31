import { create } from 'zustand';
import {
  descendants,
  isLocked,
  newProject,
  node,
  reparent,
  selectionRoots,
  uid,
  worldMatrix,
} from './model';
import type { Kind, Project, SceneNode, Vec3 } from './model';
import { Vector3 } from 'three';
type Tool = 'translate' | 'rotate' | 'scale';
interface State {
  project: Project;
  selected: string[];
  past: Project[];
  future: Project[];
  revision: number;
  tool: Tool;
  space: 'world' | 'local';
  snap: boolean;
  snapMove: number;
  snapAngle: number;
  snapScale: number;
  grid: boolean;
  orthographic: boolean;
  preview: boolean;
  focus: number;
  status: string;
  notice: string;
  busy: string;
  commit: (fn: (p: Project) => void) => void;
  replace: (p: Project) => void;
  select: (id: string | null, additive?: boolean) => void;
  patch: (ids: string[], patch: Partial<SceneNode>) => void;
  add: (kind: Kind, position?: Vec3) => void;
  remove: () => void;
  duplicate: () => void;
  group: () => void;
  parent: (ids: string[], parent: string | null) => void;
  undo: () => void;
  redo: () => void;
}
export const useStudio = create<State>((set, get) => ({
  project: newProject(true),
  selected: [],
  past: [],
  future: [],
  revision: 0,
  tool: 'translate',
  space: 'world',
  snap: false,
  snapMove: 0.5,
  snapAngle: 15,
  snapScale: 0.1,
  grid: true,
  orthographic: false,
  preview: false,
  focus: 0,
  status: 'Loading local projects…',
  notice: '',
  busy: '',
  commit: (fn) => {
    const s = get(),
      p = structuredClone(s.project);
    fn(p);
    if (JSON.stringify(p) === JSON.stringify(s.project)) return;
    set({
      project: p,
      past: [...s.past.slice(-79), s.project],
      future: [],
      revision: s.revision + 1,
      status: 'Unsaved changes',
    });
  },
  replace: (project) =>
    set((s) => ({
      project,
      selected: [],
      past: [],
      future: [],
      revision: s.revision + 1,
      preview: false,
      status: 'Unsaved changes',
    })),
  select: (id, additive = false) =>
    set((s) => ({
      selected: !id
        ? []
        : additive
          ? s.selected.includes(id)
            ? s.selected.filter((x) => x !== id)
            : [...s.selected, id]
          : [id],
    })),
  patch: (ids, patch) =>
    get().commit((p) => {
      for (const n of p.nodes)
        if (ids.includes(n.id) && !isLocked(p.nodes, n.id)) Object.assign(n, patch);
    }),
  add: (kind, position) => {
    const n = node(kind, position ? { position } : {});
    get().commit((p) => {
      p.nodes.push(n);
      if (kind === 'camera' && !p.previewCamera) p.previewCamera = n.id;
    });
    set({ selected: [n.id] });
  },
  remove: () => {
    const s = get(),
      ids = descendants(
        s.project.nodes,
        s.selected.filter((id) => !isLocked(s.project.nodes, id)),
      );
    s.commit((p) => {
      p.nodes = p.nodes.filter((n) => !ids.has(n.id));
      if (p.previewCamera && ids.has(p.previewCamera)) p.previewCamera = null;
    });
    set({ selected: [] });
  },
  duplicate: () => {
    const s = get(),
      roots = selectionRoots(
        s.project.nodes,
        s.selected.filter((id) => !isLocked(s.project.nodes, id)),
      ),
      all = descendants(s.project.nodes, roots);
    const map = new Map([...all].map((id) => [id, uid()]));
    s.commit((p) => {
      p.nodes.push(
        ...s.project.nodes
          .filter((n) => all.has(n.id))
          .map((n) => ({
            ...structuredClone(n),
            id: map.get(n.id)!,
            name: roots.includes(n.id) ? `${n.name} copy` : n.name,
            parent: n.parent && map.has(n.parent) ? map.get(n.parent)! : n.parent,
            position: roots.includes(n.id)
              ? ([n.position[0] + 0.5, n.position[1], n.position[2] + 0.5] as Vec3)
              : n.position,
          })),
      );
    });
    set({ selected: roots.map((id) => map.get(id)!) });
  },
  group: () => {
    const s = get(),
      roots = selectionRoots(
        s.project.nodes,
        s.selected.filter((id) => !isLocked(s.project.nodes, id)),
      );
    if (!roots.length) return;
    const center = new Vector3();
    roots.forEach((id) =>
      center.add(new Vector3().setFromMatrixPosition(worldMatrix(s.project.nodes, id))),
    );
    center.divideScalar(roots.length);
    const g = node('group', { name: 'Group', position: center.toArray() as Vec3 });
    try {
      s.commit((p) => {
        p.nodes.push(g);
        p.nodes = reparent(p, roots, g.id).nodes;
      });
      set({ selected: [g.id] });
    } catch (e) {
      set({ notice: (e as Error).message });
    }
  },
  parent: (ids, parent) => {
    const s = get();
    if (
      (parent && isLocked(s.project.nodes, parent)) ||
      ids.some((id) => isLocked(s.project.nodes, id))
    )
      return;
    try {
      const result = reparent(s.project, ids, parent);
      s.commit((p) => {
        p.nodes = result.nodes;
      });
    } catch (e) {
      set({ notice: (e as Error).message });
    }
  },
  undo: () => {
    const s = get();
    if (!s.past.length) return;
    set({
      project: s.past.at(-1)!,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
      selected: [],
      revision: s.revision + 1,
      status: 'Unsaved changes',
    });
  },
  redo: () => {
    const s = get();
    if (!s.future.length) return;
    set({
      project: s.future[0],
      past: [...s.past, s.project],
      future: s.future.slice(1),
      selected: [],
      revision: s.revision + 1,
      status: 'Unsaved changes',
    });
  },
}));
export function notify(notice: string) {
  useStudio.setState({ notice });
}
