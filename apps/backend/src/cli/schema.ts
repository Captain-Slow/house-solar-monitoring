import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvOrExit } from '../config/env.js';
import { createApp } from '../main.js';

/**
 * Dev script (`npm run schema`): regenerates the committed schema.gql from the code-first
 * definitions. Never connects to a database (the placeholder URL is not dialled) and keeps its
 * throwaway TLS material in a temp directory.
 */
const tmp = mkdtempSync(join(tmpdir(), 'solar-schema-'));
try {
  const env = loadEnvOrExit({
    DATABASE_URL: 'postgresql://schema@127.0.0.1:1/schema',
    ...process.env,
    COLLECTOR_ENABLED: 'false',
    TLS_DIR: tmp,
    BACKUP_DIR: tmp,
    LOG_LEVEL: 'silent',
  });
  const app = await createApp(env, { schemaFile: 'schema.gql' });
  await app.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
