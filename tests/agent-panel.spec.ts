import { test, expect } from '@playwright/test';

test('configured panel edits the current scene without native WebMCP and forgets credentials', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, 'modelContext', { value: undefined }),
  );
  let requests = 0;
  await page.route(
    'https://stranger-builds.truefoundry.cloud/api/llm/v1/responses',
    async (route) => {
      const body = route.request().postDataJSON();
      expect(route.request().headers().authorization).toBe('Bearer test-session-key');
      expect(JSON.stringify(body)).not.toContain('test-session-key');
      expect(body.tools).toHaveLength(18);
      requests++;
      await route.fulfill({
        json:
          requests === 1
            ? {
                output: [
                  {
                    type: 'function_call',
                    call_id: 'create-1',
                    name: 'studio_create_objects',
                    arguments: JSON.stringify({
                      objects: [{ kind: 'box', name: 'Panel pavilion' }],
                    }),
                  },
                ],
              }
            : {
                output: [
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: 'Created the pavilion.' }],
                  },
                ],
              },
      });
    },
  );
  await page.goto('./');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configure your agent' })).toBeVisible();
  await page.getByLabel('API key', { exact: true }).fill('test-session-key');
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await page.getByLabel('Message agent').fill('Add a pavilion');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Created the pavilion.', { exact: true })).toBeVisible();
  await expect(page.getByText('Panel pavilion', { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain('test-session-key');
  await page.screenshot({ path: 'artifacts/agent-panel.png' });
  await page.getByRole('button', { name: 'Undo (Ctrl/⌘ Z)', exact: true }).click();
  await expect(page.getByText('Panel pavilion', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
});

test('panel handles auth errors and cancellation during approval', async ({ page }) => {
  let fail = true;
  await page.route('**/api/llm/v1/responses', (route) =>
    route.fulfill(
      fail
        ? { status: 401, body: 'Unauthorized' }
        : {
            json: {
              output: [
                {
                  type: 'function_call',
                  call_id: 'delete-1',
                  name: 'studio_organize_objects',
                  arguments: '{"action":"delete","ids":["anything"]}',
                },
              ],
            },
          },
    ),
  );
  await page.goto('./');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('API key', { exact: true }).fill('test-key');
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await page.getByLabel('Message agent').fill('hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 401');
  fail = false;
  await page.getByLabel('Message agent').fill('delete');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Approve scene change?')).toBeVisible();
  await page.getByRole('button', { name: 'Stop agent', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stopped');
  await expect(page.getByText('Approve scene change?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agent settings' }).click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
});

test('reference images are previewed, removable and sent to the model with scene tools', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/llm/v1/responses', async (route) => {
    const body = route.request().postDataJSON();
    const content = body.input[0].content;
    expect(content[0].text).toContain('reference images');
    expect(content[1]).toMatchObject({ type: 'input_image', detail: 'high' });
    expect(content[1].image_url).toMatch(/^data:image\/png;base64,/);
    requests++;
    await route.fulfill({
      json: {
        output:
          requests === 1
            ? [
                {
                  type: 'function_call',
                  call_id: 'image-create',
                  name: 'studio_create_objects',
                  arguments: JSON.stringify({
                    objects: [{ kind: 'box', name: 'Image reference house' }],
                  }),
                },
              ]
            : [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: 'Created from your reference.' }],
                },
              ],
      },
    });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('API key', { exact: true }).fill('test-key');
  await page.getByRole('button', { name: 'Start chatting' }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    return canvas.toDataURL().split(',')[1];
  });
  const file = { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  await page.getByLabel('Reference images', { exact: true }).setInputFiles(file);
  await expect(page.getByAltText('reference.png')).toBeVisible();
  await page.getByRole('button', { name: 'Remove reference.png' }).click();
  await expect(page.getByAltText('reference.png')).toHaveCount(0);
  await page
    .getByLabel('Reference images', { exact: true })
    .setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('Use PNG');
  await page.getByLabel('Reference images', { exact: true }).setInputFiles(file);
  await expect(page.getByAltText('reference.png')).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Created from your reference.', { exact: true })).toBeVisible();
  await expect(page.getByText('Image reference house', { exact: true })).toBeVisible();
  await expect(page.getByAltText('reference.png')).toBeVisible();
  expect(requests).toBe(2);
});

test('manual stop cancels a pending gateway request and allows another message', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route('**/api/llm/v1/responses', async (route) => {
    started = true;
    await held;
    await route.fulfill({ json: { output: [] } }).catch(() => {});
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByLabel('Tool iteration limit')).toHaveValue('100');
  await page.getByLabel('Tool iteration limit').fill('200');
  await page.getByLabel('API key', { exact: true }).fill('test-key');
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await page.getByLabel('Message agent').fill('Create a large environment');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Stop agent', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stopped by you');
  await expect(page.getByLabel('Message agent')).toBeEnabled();
  release();
});
