import { defineConfig, devices } from '@playwright/test';

// Tests get their own port (npm start uses 4173) and always start their own server from this folder,
// so they can never test another checkout's code. If the port is taken, the run stops with an error.
// Running tests in a second checkout at the same time? Give it another port: TEST_PORT=4198 npm test
const PORT = Number(process.env.TEST_PORT) || 4199;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // npm test (and CI) runs Chromium; npm run test:webkit runs the same tests in WebKit.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Playwright's WebKit on Windows runs the game at about 15 frames a second and each click takes over a second,
    // so its long playthroughs get more time.
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }, timeout: 90000, expect: { timeout: 10000 } },
  ],
  webServer: {
    command: `node tests/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
