import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgentTools } from './agentTools';
import { newProject, node } from './model';
import { useStudio } from './store';
const tools = buildAgentTools({ persist: vi.fn(async () => {}) });
async function call(name: string, input: unknown, signal = new AbortController().signal) {
  const response = await tools.find((t) => t.name === `studio_${name}`)!.execute(input, { signal });
  return { ...response, data: JSON.parse(response.content[0].text) };
}
beforeEach(() =>
  useStudio.setState({
    project: newProject(),
    past: [],
    future: [],
    selected: [],
    revision: 0,
    notice: '',
    busy: '',
  }),
);
describe('agent commands', () => {
  it('publishes discoverable schemas and accurate read-only metadata', () => {
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    expect(tools.find((t) => t.name === 'studio_get_scene')!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'studio_update_objects')!.annotations.readOnlyHint).toBe(
      false,
    );
    expect(tools.every((t) => (t.inputSchema as { type: string }).type === 'object')).toBe(true);
  });
  it('creates a batch in one undo entry, updates it and undoes via shared history', async () => {
    const created = await call('create_objects', {
      objects: [{ kind: 'box', name: 'Agent cube', position: [1, 2, 3] }, { kind: 'sphere' }],
    });
    expect(created.data.ok).toBe(true);
    expect(useStudio.getState().past).toHaveLength(1);
    const id = created.data.result[0].id;
    const update = await call('update_objects', {
      updates: [{ id, changes: { position: [4, 5, 6], material: { color: '#aabbcc' } } }],
    });
    expect(update.isError).toBeUndefined();
    expect(useStudio.getState().project.nodes.find((n) => n.id === id)!.material!.roughness).toBe(
      0.55,
    );
    await call('history', { action: 'undo' });
    expect(useStudio.getState().project.nodes.find((n) => n.id === id)!.position).toEqual([
      1, 2, 3,
    ]);
    await call('history', { action: 'undo' });
    expect(useStudio.getState().project.nodes).toHaveLength(2);
  });
  it('rejects invalid batches atomically with actionable tool errors', async () => {
    const n = node('box');
    useStudio.getState().commit((p) => p.nodes.push(n));
    const before = structuredClone(useStudio.getState().project);
    const response = await call('update_objects', {
      updates: [
        { id: n.id, changes: { position: [1, 2, 3] } },
        { id: 'missing', changes: { name: 'Bad' } },
      ],
    });
    expect(response.isError).toBe(true);
    expect(response.data.error).toContain('Object not found');
    expect(useStudio.getState().project).toEqual(before);
    const invalid = await call('update_objects', {
      updates: [{ id: n.id, changes: { scale: [1, 0, 1] } }],
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.data.error).toContain('nonzero');
    expect(useStudio.getState().project).toEqual(before);
    const unknown = await call('update_objects', {
      updates: [{ id: n.id, changes: { id: 'overwrite' } }],
    });
    expect(unknown.isError).toBe(true);
  });
  it('respects inherited locks and rejects hierarchy cycles without edits', async () => {
    const parent = node('group', { locked: true }),
      child = node('box', { parent: parent.id });
    useStudio.getState().commit((p) => p.nodes.push(parent, child));
    expect(
      (await call('update_objects', { updates: [{ id: child.id, changes: { name: 'No' } }] }))
        .isError,
    ).toBe(true);
    expect(
      (await call('update_objects', { updates: [{ id: parent.id, changes: { locked: false } }] }))
        .isError,
    ).toBeUndefined();
    const before = structuredClone(useStudio.getState().project);
    const cycle = await call('organize_objects', {
      action: 'reparent',
      ids: [parent.id],
      parentId: child.id,
    });
    expect(cycle.isError).toBe(true);
    expect(useStudio.getState().project).toEqual(before);
  });
  it('rejects absent asset references and non-mesh material changes', async () => {
    const n = node('box');
    useStudio.getState().commit((p) => p.nodes.push(n));
    expect(
      (
        await call('update_objects', {
          updates: [{ id: n.id, changes: { material: { texture: 'missing' } } }],
        })
      ).isError,
    ).toBe(true);
    expect((await call('update_project', { previewCamera: n.id })).isError).toBe(true);
    expect(
      (
        await call('update_objects', {
          updates: [
            {
              id: useStudio.getState().project.nodes[0].id,
              changes: { material: { color: '#ffffff' } },
            },
          ],
        })
      ).isError,
    ).toBe(true);
  });
  it('honors pre-cancellation and serializes writes while allowing inspection', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(
      (await call('create_objects', { objects: [{ kind: 'box' }] }, aborted.signal)).isError,
    ).toBe(true);
    useStudio.setState({ busy: 'Importing assets…' });
    expect((await call('create_objects', { objects: [{ kind: 'box' }] })).isError).toBe(true);
    expect(useStudio.getState().busy).toBe('Importing assets…');
    expect((await call('get_scene', {})).data.ok).toBe(true);
  });
});
