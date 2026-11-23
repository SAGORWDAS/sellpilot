import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { makeDb } from '../src/db';

export const TEST_PORT = 54330;
export const EMBEDDED_URL = `postgresql://postgres:dev@localhost:${TEST_PORT}/sellpilot_test`;

export default async function setup() {
  process.env.SESSION_SECRET ??= randomBytes(32).toString('base64');
  process.env.SECRETS_KEY ??= randomBytes(32).toString('base64');

  if (process.env.TEST_DATABASE_URL) {
    await applyMigrations(process.env.TEST_DATABASE_URL);
    return;
  }

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dataDir = mkdtempSync(join(tmpdir(), 'sellpilot-pg-'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'dev',
    port: TEST_PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('sellpilot_test');

  process.env.TEST_DATABASE_URL = EMBEDDED_URL;
  await applyMigrations(EMBEDDED_URL);

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}

async function applyMigrations(url: string) {
  const db = makeDb(url);
  await migrate(db, { migrationsFolder: './drizzle' });
}