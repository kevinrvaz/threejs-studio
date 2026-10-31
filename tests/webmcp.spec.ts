import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
async function call(page: Page, name: string, input: unknown = {}) {
  const raw = await page.evaluate(
    async ({ name, input }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`Tool not registered: ${name}`);
      return document.modelContext.executeTool(tool, input as object);
    },
    { name, input },
  );
  const result = JSON.parse(raw);
  return { ...result, data: JSON.parse(result.content[0].text) };
}
test('native WebMCP discovers tools and agent edits update the UI with undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByText('WebMCP · 18 tools')).toBeVisible({ timeout: 15000 });
  const discovered = await page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => ({ name: t.name, schema: t.inputSchema })),
  );
  expect(discovered).toHaveLength(18);
  expect(discovered.some((t) => t.name === 'studio_create_objects')).toBe(true);
  const initial = await call(page, 'studio_get_scene');
  expect(initial.data.result.project.nodes).toHaveLength(11);
  const created = await call(page, 'studio_create_objects', {
    objects: [
      {
        kind: 'box',
        name: 'Agent pavilion',
        position: [2, 1, 0],
        scale: [2, 2, 2],
        material: { color: '#85bfa1' },
      },
    ],
  });
  expect(created.isError).toBeUndefined();
  const id = created.data.result[0].id;
  await expect(page.getByLabel('Object name')).toHaveValue('Agent pavilion');
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('2');
  const updated = await call(page, 'studio_update_objects', {
    updates: [{ id, changes: { position: [3, 1, 0] } }],
  });
  expect(updated.data.ok).toBe(true);
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Undo (Ctrl/⌘ Z)', exact: true }).click();
  await page.getByText('Agent pavilion', { exact: true }).click();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('2');
  const invalid = await call(page, 'studio_update_objects', {
    updates: [{ id, changes: { scale: [1, 0, 1] } }],
  });
  expect(invalid.isError).toBe(true);
  expect(invalid.data.error).toContain('nonzero');
  await expect(page.getByLabel('X scale', { exact: true })).toHaveValue('2');
  expect(errors).toEqual([]);
  const save = await call(page, 'studio_save_project');
  expect(save.data.result.saved).toBe(true);
  await page.reload();
  await expect(page.getByText('Agent pavilion', { exact: true })).toBeVisible();
  await expect(page.getByText('WebMCP · 18 tools')).toBeVisible();
});
test('WebMCP asset and project operations reuse visible editor workflows', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('WebMCP · 18 tools')).toBeVisible();
  const created = await call(page, 'studio_new_project', { name: 'Agent world' });
  expect(created.data.ok).toBe(true);
  await expect(page.getByLabel('Project name')).toHaveValue('Agent world');
  const list = await call(page, 'studio_list_projects');
  expect(list.data.result.some((p: { name: string }) => p.name === 'Sculpture garden')).toBe(true);
  await call(page, 'studio_create_objects', {
    objects: [
      { kind: 'plane', name: 'Agent ground', scale: [10, 10, 1] },
      { kind: 'sphere', name: 'Agent sphere' },
    ],
  });
  const scene = await call(page, 'studio_get_scene'),
    sphere = scene.data.result.project.nodes.find(
      (n: { name: string }) => n.name === 'Agent sphere',
    );
  await call(page, 'studio_organize_objects', { action: 'duplicate', ids: [sphere.id] });
  await expect(page.getByText('Agent sphere copy', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  const exported = await call(page, 'studio_export_glb');
  await pending;
  expect(exported.data.ok).toBe(true);
  await call(page, 'studio_set_view', { preview: true });
  await expect(page.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
});

test('a real gizmo drag is one shared undoable transform gesture', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('WebMCP · 18 tools')).toBeVisible();
  await call(page, 'studio_new_project', { name: 'Gizmo check' });
  const created = await call(page, 'studio_create_objects', {
    objects: [{ kind: 'box', name: 'Gizmo cube' }],
  });
  const id = created.data.result[0].id;
  await call(page, 'studio_select_objects', { ids: [id], focus: true });
  const canvas = await page.locator('.viewport canvas').boundingBox();
  if (!canvas) throw new Error('Viewport did not mount.');
  const x = canvas.x + canvas.width / 2,
    y = canvas.y + canvas.height / 2;
  await page.mouse.move(x, y - 60);
  await page.mouse.down();
  await page.mouse.move(x, y - 115, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Y position', { exact: true }).inputValue()))
    .toBeGreaterThan(0.5);
  await call(page, 'studio_history', { action: 'undo' });
  let scene = await call(page, 'studio_get_scene');
  expect(scene.data.result.project.nodes.find((n: { id: string }) => n.id === id).position).toEqual(
    [0, 0.5, 0],
  );
  await call(page, 'studio_history', { action: 'undo' });
  scene = await call(page, 'studio_get_scene');
  expect(scene.data.result.project.nodes.some((n: { id: string }) => n.id === id)).toBe(false);
});

test('the editor remains usable when WebMCP is unavailable', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true }),
  );
  await page.goto('./');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByText('WebMCP unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Cube PRIMITIVE', exact: true }).dblclick();
  await expect(page.getByLabel('Object name')).toHaveValue('Box');
});
