import { defineConfig } from 'prisma/config';
import { buildDatabaseUrl } from './src/config/database-url.js';

// Imports only ./src/config/database-url (node:fs only): the runtime image contains nothing else.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: buildDatabaseUrl(process.env) },
});
