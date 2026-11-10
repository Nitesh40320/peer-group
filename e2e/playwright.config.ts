import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4100;

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', headless: true, screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx tsx --conditions=source --env-file-if-exists=.env backend/src/index.ts',
    cwd: path.resolve(import.meta.dirname, '..'),
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NODE_ENV: 'test', PORT: String(PORT), APP_ORIGIN: `http://localhost:${PORT}`, SMTP_HOST: '', ANTHROPIC_API_KEY: '',
      STORAGE_DIR: path.join(os.tmpdir(), 'peerconnect-e2e-storage'), LOG_LEVEL: 'error',
    },
  },
});
