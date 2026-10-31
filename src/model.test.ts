import { beforeEach, describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import {
  descendants,
  newProject,
  node,
  reparent,
  selectionRoots,
  validateProject,
  worldMatrix,
} from './model';
import { useStudio } from './store';
function sameMatrix(a: Matrix4, b: Matrix4) {
  a.elements.forEach((value, i) => expect(value).toBeCloseTo(b.elements[i], 6));
}
beforeEach(() =>
  useStudio.setState({
    project: newProject(),
    past: [],
    future: [],
    selected: [],
    revision: 0,
    notice: '',
  }),
);
describe('scene graph', () => {
  it('preserves a child world transform when parenting and unparenting', () => {
    const p = newProject(),
      parent = node('group', { position: [4, 3, -2], rotation: [20, 40, 10], scale: [2, 2, 2] }),
      child = node('box', { position: [-3, 1, 4], rotation: [12, 25, 7] });
    p.nodes.push(parent, child);
    const before = worldMatrix(p.nodes, child.id),
      next = reparent(p, [child.id], parent.id);
    sameMatrix(worldMatrix(next.nodes, child.id), before);
    sameMatrix(worldMatrix(reparent(next, [child.id], null).nodes, child.id), before);
    expect(p.nodes.find((n) => n.id === child.id)!.parent).toBeNull();
  });
  it('rejects hierarchy cycles without mutating the project', () => {
    const p = newProject(),
      parent = node('group'),
      child = node('box', { parent: parent.id });
    p.nodes.push(parent, child);
    expect(() => reparent(p, [parent.id], child.id)).toThrow(/children/);
    expect(() => reparent(p, [child.id], child.id)).toThrow();
    expect(parent.parent).toBeNull();
  });
  it('filters nested selections so a subtree is transformed only once', () => {
    const a = node('group'),
      b = node('box', { parent: a.id }),
      c = node('sphere');
    expect(selectionRoots([a, b, c], [a.id, b.id, c.id])).toEqual([a.id, c.id]);
    expect(descendants([a, b, c], [a.id])).toEqual(new Set([a.id, b.id]));
  });
  it('validates demo scenes and rejects broken references, invalid numbers and future versions', () => {
    expect(validateProject(newProject(true)).version).toBe(1);
    expect(() => validateProject({ ...newProject(), version: 2 })).toThrow(/version/);
    const p = newProject();
    p.nodes[0].parent = 'missing';
    expect(() => validateProject(p)).toThrow(/parent/);
    const q = newProject();
    q.nodes[0].position[0] = NaN;
    expect(() => validateProject(q)).toThrow(/transform/);
  });
  it('rejects duplicate IDs, zero scale, cycles, and missing preview cameras', () => {
    const p = newProject();
    p.nodes.push(structuredClone(p.nodes[0]));
    expect(() => validateProject(p)).toThrow(/Duplicate/);
    const q = newProject();
    q.nodes[0].scale[1] = 0;
    expect(() => validateProject(q)).toThrow(/nonzero/);
    const r = newProject();
    r.nodes[0].parent = r.nodes[1].id;
    r.nodes[1].parent = r.nodes[0].id;
    expect(() => validateProject(r)).toThrow(/Circular/);
    const t = newProject();
    t.previewCamera = 'missing';
    expect(() => validateProject(t)).toThrow(/camera/);
  });
});
describe('editor commands', () => {
  it('records one history entry for a multi-object edit and supports undo/redo', () => {
    const s = useStudio.getState();
    s.add('box');
    s.add('sphere');
    const ids = useStudio
      .getState()
      .project.nodes.slice(-2)
      .map((n) => n.id);
    const past = useStudio.getState().past.length;
    s.patch(ids, { position: [3, 4, 5] });
    expect(useStudio.getState().past).toHaveLength(past + 1);
    expect(useStudio.getState().project.nodes.at(-1)!.position).toEqual([3, 4, 5]);
    s.undo();
    expect(useStudio.getState().project.nodes.at(-1)!.position).toEqual([0, 0.5, 0]);
    s.redo();
    expect(useStudio.getState().project.nodes.at(-1)!.position).toEqual([3, 4, 5]);
  });
  it('groups objects without moving them, and undoes the entire group operation', () => {
    const s = useStudio.getState();
    s.add('box', [2, 3, 4]);
    s.add('sphere', [-2, 1, 0]);
    const p = useStudio.getState().project,
      ids = p.nodes.slice(-2).map((n) => n.id);
    useStudio.setState({ selected: ids });
    s.group();
    const next = useStudio.getState().project;
    ids.forEach((id) => sameMatrix(worldMatrix(next.nodes, id), worldMatrix(p.nodes, id)));
    expect(next.nodes.at(-1)!.kind).toBe('group');
    s.undo();
    expect(useStudio.getState().project).toEqual(p);
  });
  it('duplicates a selected subtree with fresh IDs and repaired parent references', () => {
    const p = newProject(),
      parent = node('group'),
      child = node('box', { parent: parent.id });
    p.nodes.push(parent, child);
    useStudio.setState({ project: p, selected: [parent.id, child.id] });
    useStudio.getState().duplicate();
    const clones = useStudio.getState().project.nodes.slice(-2);
    expect(clones[0].id).not.toBe(parent.id);
    expect(clones[1].parent).toBe(clones[0].id);
    expect(useStudio.getState().selected).toEqual([clones[0].id]);
  });
  it('deletes descendants and clears a removed preview camera; undo restores both', () => {
    const p = newProject(),
      parent = node('group'),
      camera = node('camera', { parent: parent.id });
    p.nodes.push(parent, camera);
    p.previewCamera = camera.id;
    useStudio.setState({ project: p, selected: [parent.id] });
    useStudio.getState().remove();
    expect(useStudio.getState().project.previewCamera).toBeNull();
    expect(useStudio.getState().project.nodes.some((n) => n.id === camera.id)).toBe(false);
    useStudio.getState().undo();
    expect(useStudio.getState().project).toEqual(p);
  });
  it('respects inherited locks and avoids history entries for no-op changes', () => {
    const p = newProject(),
      parent = node('group', { locked: true }),
      child = node('box', { parent: parent.id });
    p.nodes.push(parent, child);
    useStudio.setState({ project: p, selected: [child.id] });
    const s = useStudio.getState();
    s.patch([child.id], { name: 'Changed' });
    s.remove();
    expect(useStudio.getState().project.nodes.find((n) => n.id === child.id)?.name).toBe(
      child.name,
    );
    expect(useStudio.getState().past).toHaveLength(0);
  });
  it('clears redo after a new command and resets history on project switch', () => {
    const s = useStudio.getState();
    s.add('box');
    s.undo();
    expect(useStudio.getState().future).toHaveLength(1);
    s.add('sphere');
    expect(useStudio.getState().future).toHaveLength(0);
    s.replace(newProject());
    expect(useStudio.getState().past).toHaveLength(0);
    expect(useStudio.getState().selected).toHaveLength(0);
  });
});

it('rejects parenting that would introduce shear without changing the scene', () => {
  const p = newProject(),
    parent = node('group', { scale: [2, 1, 1], rotation: [0, 40, 0] }),
    child = node('box', { rotation: [15, 20, 30] });
  p.nodes.push(parent, child);
  const before = structuredClone(p);
  expect(() => reparent(p, [child.id], parent.id)).toThrow(/shear/);
  expect(p).toEqual(before);
});
