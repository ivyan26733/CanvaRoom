import { readFile } from 'node:fs/promises';
import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';

// Neon URLs say `sslmode=require`, which pg treats as full certificate
// verification today but will weaken in its next major version. Keep it strict.
const strictSsl = (url: string) =>
  url.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)\b/, '$1verify-full');

/**
 * Pooled Postgres connection. On Vercel `DATABASE_URL` is Neon's pooled
 * (PgBouncer) address, so each instance keeps only a few connections open and
 * releases them when it is suspended.
 */
export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: strictSsl(connectionString),
    max: 8,
    // Opening a connection to Neon (Singapore) from the function (Mumbai)
    // takes about 7 round trips, ~400 ms. Keeping idle connections for 30 s
    // means a save after a pause in drawing reuses one; with 5 s, most saves
    // after someone stopped to talk or think paid that extra ~400 ms.
    // attachDatabasePool keeps the instance alive until they close, so this
    // is a small extra in function time, not a leak.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client can be dropped by the server; the pool replaces it.
  pool.on('error', (error) => console.error('Postgres pool error', error));
  attachDatabasePool(pool);
  return pool;
}

/** Applies db/schema.sql. Every statement in it is safe to repeat. */
export async function migrate(connectionString: string) {
  const sql = await readFile(
    new URL('../db/schema.sql', import.meta.url),
    'utf8',
  );
  const client = new pg.Client({
    connectionString: strictSsl(connectionString),
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
