import { describe, expect, it } from 'vitest';
import { createPool } from './prisma.service.js';

describe('createPool', () => {
  it('survives an idle-client error instead of crashing the process', async () => {
    const pool = createPool({
      DATABASE_URL: 'postgresql://solar:x@127.0.0.1:1/solar',
    });
    try {
      // An EventEmitter throws on 'error' without a listener: that would be an uncaught exception
      // when PostgreSQL restarts while a pooled connection is idle.
      expect(() =>
        pool.emit('error', new Error('terminating connection')),
      ).not.toThrow();
    } finally {
      await pool.end();
    }
  });
});
