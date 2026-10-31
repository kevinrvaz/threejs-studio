import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Opening your studio…')).toBeHidden();
  await expect(page.getByText('All changes saved')).toBeVisible();
});
test('scene editing, history, preview, camera mode and reload recovery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('.viewport canvas')).toBeVisible();
  await expect(page.locator('.viewport-error')).toHaveCount(0);
  await page.getByText('Orbit sculpture', { exact: true }).click();
  await expect(page.getByLabel('Object name')).toHaveValue('Orbit sculpture');
  await page.getByLabel('X position', { exact: true }).fill('2.5');
  await page.getByLabel('X position', { exact: true }).press('Enter');
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Undo (Ctrl/⌘ Z)', exact: true }).click();
  await page.getByText('Orbit sculpture', { exact: true }).click();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('-1.7');
  await page.getByRole('button', { name: 'Redo (Ctrl/⌘ Shift Z)', exact: true }).click();
  await page.getByText('Orbit sculpture', { exact: true }).click();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('CAMERA PREVIEW', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('SCENE VIEW', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle orthographic view' }).click();
  await expect(page.getByText('Orthographic', { exact: true })).toBeVisible();
  await page.getByLabel('Project name').fill('Recovered garden');
  await page.getByLabel('Project name').press('Enter');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Recovered garden');
  await page.getByText('Orbit sculpture', { exact: true }).click();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('2.5');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/editor.png' });
});
test('drag primitive, group, reparent, duplicate and delete with undo', async ({ page }) => {
  const count = await page.locator('.hierarchy-row').count();
  const asset = page.locator('.asset-card').filter({ hasText: 'Cube' });
  await asset.dragTo(page.locator('.viewport canvas'), { targetPosition: { x: 350, y: 220 } });
  await expect(page.locator('.hierarchy-row')).toHaveCount(count + 1);
  await page.getByLabel('Object name').fill('Dropped cube');
  await page.getByLabel('Object name').press('Enter');
  await page.getByText('Coral sphere', { exact: true }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group selection (Ctrl/⌘ G)' }).click();
  await expect(page.getByLabel('Object name')).toHaveValue('Group');
  await page.getByRole('button', { name: 'Duplicate selection (Ctrl/⌘ D)' }).click();
  await expect(page.getByLabel('Object name')).toHaveValue('Group copy');
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  await expect(page.locator('.hierarchy-row').filter({ hasText: 'Group copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo (Ctrl/⌘ Z)', exact: true }).click();
  await expect(page.locator('.hierarchy-row').filter({ hasText: 'Group copy' })).toHaveCount(1);
});
test('portable project download and reopen, GLB export and import', async ({ page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const project = await projectDownload;
  const projectPath = (await project.path())!;
  const contents = unzipSync(await readFile(projectPath));
  const document = JSON.parse(strFromU8(contents['project.json']));
  expect(document.nodes.length).toBe(11);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const glbDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export scene as GLB' }).click();
  const glb = await glbDownload,
    glbPath = (await glb.path())!;
  const bytes = await readFile(glbPath);
  expect(bytes.subarray(0, 4).toString()).toBe('glTF');
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'Garden.glb', mimeType: 'model/gltf-binary', buffer: bytes });
  await expect(page.locator('.asset-card').filter({ hasText: 'Garden.glb' })).toBeVisible();
  await page.locator('.asset-card').filter({ hasText: 'Garden.glb' }).dblclick();
  await expect(page.getByLabel('Object name')).toHaveValue('Garden');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Empty world', exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Untitled world');
  await page.locator('input[type=file]:not([multiple])').setInputFiles({
    name: 'garden.threejsstudio',
    mimeType: 'application/zip',
    buffer: await readFile(projectPath),
  });
  await expect(page.getByLabel('Project name')).toHaveValue('Sculpture garden');
  await expect(page.locator('.hierarchy-row')).toHaveCount(11);
});
test('failed imports preserve the current project and show useful errors', async ({ page }) => {
  await page.locator('input[type=file]:not([multiple])').setInputFiles({
    name: 'broken.threejsstudio',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a zip'),
  });
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Sculpture garden');
  await expect(page.locator('.hierarchy-row')).toHaveCount(11);
  const missing = JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'missing.bin', byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'missing.gltf',
    mimeType: 'model/gltf+json',
    buffer: Buffer.from(missing),
  });
  await expect(page.getByRole('status')).toContainText('missing.bin');
  await expect(page.locator('.hierarchy-row')).toHaveCount(11);
});
test('textured glTF companions survive project packing, reload and reopen', async ({ page }) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e8b154';
    ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const geometry = Buffer.alloc(66);
  new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 1]).forEach((v, i) =>
    geometry.writeFloatLE(v, i * 4),
  );
  [0, 1, 2].forEach((v, i) => geometry.writeUInt16LE(v, 60 + i * 2));
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'geometry.bin', byteLength: 66 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [2, 2, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    images: [{ uri: 'gold.png' }],
    textures: [{ source: 0 }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.5,
        },
      },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] },
    ],
    nodes: [{ mesh: 0, name: 'Textured triangle' }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  await page.locator('input[type=file][multiple]').setInputFiles([
    {
      name: 'triangle.gltf',
      mimeType: 'model/gltf+json',
      buffer: Buffer.from(JSON.stringify(gltf)),
    },
    { name: 'geometry.bin', mimeType: 'application/octet-stream', buffer: geometry },
    { name: 'gold.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ]);
  const model = page.locator('.asset-card').filter({ hasText: 'triangle.gltf' });
  await expect(model).toBeVisible();
  await expect(model.locator('img')).toBeVisible();
  await model.dblclick();
  await page.getByText('Textured triangle', { exact: true }).click();
  await page.getByLabel('Roughness', { exact: true }).fill('0.75');
  await page.getByLabel('Roughness', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project' }).click();
  const file = await pending,
    data = await readFile((await file.path())!),
    entries = unzipSync(data),
    doc = JSON.parse(strFromU8(entries['project.json']));
  expect(doc.assets).toHaveLength(2);
  expect(Object.keys(entries)).toHaveLength(3);
  const modelAsset = doc.assets.find((a: { type: string }) => a.type === 'model');
  expect(JSON.parse(strFromU8(entries[modelAsset.file])).images).toHaveLength(1);
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await expect(model).toBeVisible();
  await page.getByText('Textured triangle', { exact: true }).click();
  await expect(page.getByLabel('Roughness', { exact: true })).toHaveValue('0.75');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Empty world', exact: true }).click();
  await page
    .locator('input[type=file]:not([multiple])')
    .setInputFiles({ name: 'textured.threejsstudio', mimeType: 'application/zip', buffer: data });
  await page.getByText('Textured triangle', { exact: true }).click();
  await expect(page.getByLabel('Roughness', { exact: true })).toHaveValue('0.75');
  await expect(model.locator('img')).toBeVisible();
});
