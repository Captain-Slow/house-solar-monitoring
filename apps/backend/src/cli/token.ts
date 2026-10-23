import { createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../db/prisma.service.js';
import { TokenService } from '../auth/token.service.js';
import { ConfigError, parseEnv } from '../config/env.js';
import { isMain } from './is-main.js';

export async function runTokenCli(
  args: string[],
  source: Readonly<Record<string, string | undefined>> = process.env,
  print: (line: string) => void = console.log,
): Promise<void> {
  const env = parseEnv({ ...source, COLLECTOR_ENABLED: 'false' });
  const prisma = new PrismaService(source);
  const tokens = new TokenService(prisma);
  try {
    const [command, ...rest] = args;
    if (command === 'create') {
      const nameIndex = rest.indexOf('--name');
      const roleIndex = rest.indexOf('--role');
      const name = rest[nameIndex + 1];
      const role = rest[roleIndex + 1];
      if (
        nameIndex < 0 ||
        roleIndex < 0 ||
        !name ||
        (role !== 'ADMIN' && role !== 'VIEWER')
      )
        throw new Error(
          'Usage: token create --name <name> --role ADMIN|VIEWER',
        );
      const cert = new X509Certificate(
        await readFile(join(env.TLS_DIR, 'cert.pem')),
      );
      const fingerprint = createHash('sha256')
        .update(cert.raw)
        .digest('base64');
      const created = await tokens.create(name, role);
      print(`Token: ${created.token}`);
      print(`TLS certificate fingerprint sha256/${fingerprint}`);
    } else if (command === 'list') {
      if (rest.length !== 0) throw new Error('Usage: token list');
      for (const row of await tokens.list())
        print(
          `${row.id}\t${row.name}\t${row.role}\t${row.revokedAt ? 'revoked' : 'active'}`,
        );
    } else if (command === 'revoke') {
      const id = rest[0] === '--id' ? Number(rest[1]) : NaN;
      if (!Number.isSafeInteger(id) || id < 1 || rest.length !== 2)
        throw new Error('Usage: token revoke --id <id>');
      if (!(await tokens.revoke(id)))
        throw new Error('Token not found or already revoked');
      print(`Revoked token ${id}`);
    } else {
      throw new Error('Usage: token create|list|revoke');
    }
  } finally {
    await prisma.close();
  }
}

if (isMain(import.meta.url)) {
  try {
    await runTokenCli(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof ConfigError ? error.message : 'Token operation failed',
    );
    process.exitCode = 1;
  }
}
