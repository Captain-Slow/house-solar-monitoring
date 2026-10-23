import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://solar@db:5432/solar',
  MODBUS_HOST: '192.0.2.10',
};

describe('parseEnv', () => {
  it('applies the plan defaults', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      SITE_TIMEZONE: 'Asia/Kuala_Lumpur',
      MODBUS_PORT: 502,
      MODBUS_UNIT_ID: 1,
      MODBUS_TIMEOUT_MS: 3000,
      DEVICE_KEY: 'inverter-1',
      EXPECTED_MODEL: 'HIT-10L-G3',
      OWNERSHIP_LEASE_SEC: 15,
      POLL_FAST_MS: 10_000,
      POLL_SLOW_MS: 300_000,
      POLL_SETTINGS_MS: 900_000,
      HTTPS_PORT: 8443,
      RAW_RETENTION_DAYS: 400,
      SAMPLE_RETENTION_DAYS: 400,
      COLLECTOR_ENABLED: true,
    });
  });

  it('rejects an unknown time zone and names only the field, never a value', () => {
    const err = (() => {
      try {
        parseEnv({ ...base, SITE_TIMEZONE: 'Not/AZone' });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).fields).toEqual(['SITE_TIMEZONE']);
    expect((err as ConfigError).message).not.toContain('Not/AZone');
  });

  it('requires MODBUS_HOST only when the Modbus collector will run', () => {
    expect(() => parseEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(
      /MODBUS_HOST/,
    );
    expect(() =>
      parseEnv({ DATABASE_URL: base.DATABASE_URL, COLLECTOR_ENABLED: 'false' }),
    ).not.toThrow();
    expect(() =>
      parseEnv({ DATABASE_URL: base.DATABASE_URL, COLLECTOR_SOURCE: 'NONE' }),
    ).not.toThrow();
  });

  it('does not echo a bad DATABASE_URL-like secret in the error', () => {
    try {
      parseEnv({ ...base, POLL_FAST_MS: 'abc', DATABASE_URL: '' });
    } catch (e) {
      expect((e as ConfigError).fields.sort()).toEqual([
        'DATABASE_URL',
        'POLL_FAST_MS',
      ]);
    }
  });
});
