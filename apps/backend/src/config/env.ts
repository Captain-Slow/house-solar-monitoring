import { IANAZone } from 'luxon';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');
const int = (def: number, min = 0) =>
  z.coerce.number().int().min(min).default(def);

/** Environment schema (plan Phase 2.2). `DATABASE_URL` carries no password; see config/database-url.ts. */
export const envSchema = z.object({
  SITE_TIMEZONE: z
    .string()
    .refine((v) => IANAZone.isValidZone(v), 'unknown IANA time zone')
    .default('Asia/Kuala_Lumpur'),
  DATABASE_URL: z.string().min(1),
  DATABASE_PASSWORD_FILE: z.string().min(1).optional(),
  MODBUS_HOST: z.string().min(1).optional(),
  MODBUS_PORT: int(502, 1),
  MODBUS_UNIT_ID: int(1, 0),
  MODBUS_TIMEOUT_MS: int(3000, 100),
  DEVICE_KEY: z.string().min(1).default('inverter-1'),
  EXPECTED_MODEL: z.string().min(1).default('HIT-10L-G3'),
  OWNERSHIP_LEASE_SEC: int(15, 1),
  POLL_FAST_MS: int(10_000, 1000),
  POLL_SLOW_MS: int(300_000, 1000),
  POLL_SETTINGS_MS: int(900_000, 1000),
  /** Global override: false means no collector of any source starts. */
  COLLECTOR_ENABLED: bool.default(true),
  /** Which acquisition source runs (Amendment A1). Only MODBUS is implemented. */
  COLLECTOR_SOURCE: z.enum(['MODBUS', 'NONE']).default('MODBUS'),
  HTTPS_PORT: int(8443, 1),
  TLS_DIR: z.string().min(1).default('/data/tls'),
  TLS_SUBJECT_ALT_NAMES: z.string().default(''),
  RAW_RETENTION_DAYS: int(400, 1),
  SAMPLE_RETENTION_DAYS: int(400, 1),
  BACKUP_DIR: z.string().min(1).default('/backups'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

export const EXIT_INVALID_CONFIG = 78;

/** Parses env; on any invalid value throws a ConfigError naming only the fields (never values). */
export class ConfigError extends Error {
  constructor(readonly fields: string[]) {
    super(`invalid configuration: ${fields.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function parseEnv(
  source: Readonly<Record<string, string | undefined>>,
): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError([
      ...new Set(result.error.issues.map((i) => i.path.join('.') || '(root)')),
    ]);
  }
  const env = result.data;
  if (
    env.COLLECTOR_ENABLED &&
    env.COLLECTOR_SOURCE === 'MODBUS' &&
    env.MODBUS_HOST === undefined
  ) {
    throw new ConfigError(['MODBUS_HOST']);
  }
  return env;
}

/** Process entry helper: logs the offending field names (never values) and exits 78. */
export function loadEnvOrExit(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env {
  try {
    return parseEnv(source);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`${e.message}`);
      process.exit(EXIT_INVALID_CONFIG);
    }
    throw e;
  }
}
