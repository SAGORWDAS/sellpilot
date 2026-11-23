import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { makeDb } from '@/db';
import { memberships, orgSettings, organizations, users } from '@/db/schema';
import { hashPassword } from '@/lib/auth';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = makeDb(url);

  const email = (process.argv[2] ?? 'owner@sellpilot.local').toLowerCase().trim();
  const password = process.argv[3] ?? randomBytes(12).toString('base64url');
  const name = process.argv[4] ?? 'Owner';

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`User ${email} already exists — nothing to do.`);
    process.exit(0);
  }

  const orgId = uuidv7();
  const userId = uuidv7();

  await db.insert(organizations).values({ id: orgId, name: 'My Workspace' });
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(password),
    name,
  });
  await db.insert(memberships).values({
    id: uuidv7(),
    organizationId: orgId,
    userId,
    role: 'owner',
  });
  await db.insert(orgSettings).values({ organizationId: orgId, senderName: name });

  console.log('Seeded workspace.');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});