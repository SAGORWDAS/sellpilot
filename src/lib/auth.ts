import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, lt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '@/db';
import { sessions, users } from '@/db/schema';
import { RateLimited, Unauthorized, ValidationError } from '@/lib/errors';
import { hashToken, newToken } from '@/lib/tokens';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const SESSION_TTL_DAYS = 14;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) {
    throw new ValidationError('Password must be at least 12 characters', {
      password: 'Use at least 12 characters.',
    });
  }
  return argonHash(plain, ARGON);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, plain);
  } catch {
    return false;
  }
}

export type IssuedSession = { token: string; sessionId: string; expiresAt: Date };

export async function createSession(
  db: Database,
  input: {
    userId: string;
    organizationId: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<IssuedSession> {
  const token = newToken();
  const id = uuidv7();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await db.insert(sessions).values({
    id,
    userId: input.userId,
    tokenHash: hashToken(token),
    organizationId: input.organizationId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    expiresAt,
  });

  return { token, sessionId: id, expiresAt };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeSessionByToken(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<{ userId: string }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user) {
    await argonVerify(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
      password,
    ).catch(() => false);
    throw new Unauthorized('Email or password is incorrect');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new RateLimited('Too many attempts. Try again shortly.');
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failed,
        lockedUntil:
          failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    throw new Unauthorized('Email or password is incorrect');
  }

  if (user.failedLoginCount > 0) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
  }

  return { userId: user.id };
}

export { hashToken, newToken };