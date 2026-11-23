'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { uuidv7 } from 'uuidv7';
import { db } from '@/db';
import { memberships, orgSettings, organizations, users } from '@/db/schema';
import { authenticate, createSession, hashPassword, revokeSessionByToken } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '@/lib/session';
import type { ActionState } from '@/lib/action-state';
import { cookies } from 'next/headers';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  try {
    const { userId } = await authenticate(db(), email, password);
    const [membership] = await db()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);
    if (!membership) return { error: 'This account has no workspace.' };

    const issued = await createSession(db(), {
      userId,
      organizationId: membership.organizationId,
    });
    await setSessionCookie(issued.token, issued.expiresAt);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  redirect('/dashboard');
}

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (process.env.ALLOW_SIGNUP !== 'true') {
    return { error: 'Signup is currently disabled.' };
  }
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');
  if (!name || !email) return { error: 'Enter your name and email.' };

  try {
    const passwordHash = await hashPassword(password);
    const [existing] = await db().select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) return { error: 'An account with this email already exists.' };

    const orgId = uuidv7();
    const userId = uuidv7();
    await db().insert(organizations).values({ id: orgId, name: `${name}'s Workspace` });
    await db().insert(users).values({ id: userId, email, passwordHash, name });
    await db().insert(memberships).values({
      id: uuidv7(),
      organizationId: orgId,
      userId,
      role: 'owner',
    });
    await db().insert(orgSettings).values({ organizationId: orgId, senderName: name });

    const issued = await createSession(db(), { userId, organizationId: orgId });
    await setSessionCookie(issued.token, issued.expiresAt);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionByToken(db(), token);
  await clearSessionCookie();
  redirect('/login');
}