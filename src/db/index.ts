import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof makeDb>;

export function makeDb(url: string) {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
  });
  return drizzle(client, { schema });
}

let singleton: Database | null = null;

export function db(): Database {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  singleton = makeDb(url);
  return singleton;
}

export { schema };