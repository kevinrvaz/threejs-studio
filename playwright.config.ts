import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npm run preview -- --port 4173 --base /threejs-studio/',
    url: 'http://127.0.0.1:4173/threejs-studio/',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173/threejs-studio/',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      args: [
        '--enable-webgl',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--enable-features=WebMCP',
      ],
    },
    screenshot: 'only-on-failure',
  },
});
