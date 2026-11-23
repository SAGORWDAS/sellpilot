import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '@/db';
import { memberships, sessions, users } from '@/db/schema';
import { hashToken } from '@/lib/tokens';

export type Actor = {
  userId: string;
  organizationId: string;
  role: 'owner' | 'member';
  sessionId: string;
  name: string;
  email: string;
};

export async function resolveActor(db: Database, token: string): Promise<Actor | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      organizationId: sessions.organizationId,
      role: memberships.role,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.organizationId, sessions.organizationId),
      ),
    )
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.organizationId) return null;

  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.sessionId));

  return {
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role,
    sessionId: row.sessionId,
    name: row.name,
    email: row.email,
  };
}