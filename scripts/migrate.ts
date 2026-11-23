import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { makeDb } from '../src/db';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = makeDb(url);
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});