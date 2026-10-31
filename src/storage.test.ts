import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { clear } from 'idb-keyval';
import { strToU8, zipSync } from 'fflate';
import {
  deleteProject,
  lastProject,
  listProjects,
  loadProject,
  openProject,
  saveProject,
} from './assets';
import { newProject } from './model';
describe('project persistence', () => {
  it('saves, lists, recovers and deletes independent projects', async () => {
    await clear();
    const a = newProject(true),
      b = newProject();
    await saveProject(a);
    await saveProject(b);
    expect((await listProjects()).length).toBe(2);
    expect(await lastProject()).toEqual(b);
    expect(await loadProject(a.id)).toEqual(a);
    await deleteProject(b.id);
    expect(await lastProject()).toBeNull();
    expect(await listProjects()).toHaveLength(1);
  });
  it('opens a versioned portable ZIP without changing the source document', async () => {
    const p = newProject(true),
      data = zipSync({ 'project.json': strToU8(JSON.stringify(p)) });
    const f = new File([data as Uint8Array<ArrayBuffer>], 'sample.threejsstudio');
    expect(await openProject(f)).toEqual(p);
  });
  it('rejects corrupt archives and missing bundled assets', async () => {
    await expect(openProject(new File(['bad'], 'bad.zip'))).rejects.toThrow();
    const p = newProject();
    p.assets.push({
      id: 'missing',
      name: 'Missing.glb',
      type: 'model',
      file: 'assets/missing.json',
    });
    const data = zipSync({ 'project.json': strToU8(JSON.stringify(p)) });
    await expect(
      openProject(new File([data as Uint8Array<ArrayBuffer>], 'missing.zip')),
    ).rejects.toThrow(/missing/i);
  });
  it('refuses to save incomplete asset data', async () => {
    const p = newProject();
    p.assets.push({
      id: 'absent',
      name: 'missing.png',
      type: 'texture',
      file: 'assets/missing.png',
    });
    await expect(saveProject(p)).rejects.toThrow(/Missing asset/);
  });
});
