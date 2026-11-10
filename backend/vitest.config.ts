import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  // Load @peerconnect/model from its TypeScript source, so tests never need a model build first.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      STORAGE_DIR: path.join(os.tmpdir(), 'peerconnect-test-storage'),
      SMTP_HOST: '',
      ANTHROPIC_API_KEY: '',
      MAX_UPLOAD_MB: '1',
    },
  },
});
