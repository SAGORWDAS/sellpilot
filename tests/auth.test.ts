import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db';
import { users } from '../src/db/schema';
import {
  authenticate,
  createSession,
  hashPassword,
  purgeExpiredSessions,
  revokeSessionByToken,
  verifyPassword,
} from '../src/lib/auth';
import { resolveActor } from '../src/lib/actor';
import { RateLimited, Unauthorized, ValidationError } from '../src/lib/errors';
import { seedWorkspace, testDb } from './helpers';

let db: Database;

beforeAll(() => {
  db = testDb();
});

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('a-long-enough-password');
    expect(hash).not.toContain('a-long-enough-password');
    expect(await verifyPassword(hash, 'a-long-enough-password')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('sessions', () => {
  it('resolves an actor from a session token and revokes instantly', async () => {
    const { orgId, userId } = await seedWorkspace(db);
    const issued = await createSession(db, { userId, organizationId: orgId });

    const actor = await resolveActor(db, issued.token);
    expect(actor).toMatchObject({ userId, organizationId: orgId, role: 'owner' });

    await revokeSessionByToken(db, issued.token);
    expect(await resolveActor(db, issued.token)).toBeNull();
  });

  it('does not resolve expired sessions', async () => {
    const { orgId, userId } = await seedWorkspace(db);
    const issued = await createSession(db, { userId, organizationId: orgId });
    await db
      .update(users)
      .set({ updatedAt: new Date() })
      .where(eq(users.id, userId));

    const { sessions } = await import('../src/db/schema');
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, issued.sessionId));

    expect(await resolveActor(db, issued.token)).toBeNull();
    await purgeExpiredSessions(db);
  });

  it('never resolves a session without a membership in its organization', async () => {
    const a = await seedWorkspace(db);
    const b = await seedWorkspace(db);
    const issued = await createSession(db, { userId: a.userId, organizationId: b.orgId });
    expect(await resolveActor(db, issued.token)).toBeNull();
  });
});

describe('authenticate', () => {
  it('rejects unknown email and wrong password identically', async () => {
    const { actor } = await seedWorkspace(db, { password: 'correct-horse-battery' });
    await expect(authenticate(db, 'nobody@test.local', 'whatever-long')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(authenticate(db, actor.email, 'wrong-password-here')).rejects.toBeInstanceOf(
      Unauthorized,
    );
  });

  it('locks the account after repeated failures', async () => {
    const { actor } = await seedWorkspace(db, { password: 'correct-horse-battery' });
    for (let i = 0; i < 8; i++) {
      await expect(authenticate(db, actor.email, 'wrong-password-here')).rejects.toBeInstanceOf(
        Unauthorized,
      );
    }
    await expect(authenticate(db, actor.email, 'correct-horse-battery')).rejects.toBeInstanceOf(
      RateLimited,
    );
  });

  it('signs in with the right password and resets the failure counter', async () => {
    const { actor, userId } = await seedWorkspace(db, { password: 'correct-horse-battery' });
    await expect(authenticate(db, actor.email, 'wrong-password-here')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    const result = await authenticate(db, actor.email, 'correct-horse-battery');
    expect(result.userId).toBe(userId);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.failedLoginCount).toBe(0);
  });
});