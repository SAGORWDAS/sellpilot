'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { db } from '@/db';
import { mailboxes, orgSettings } from '@/db/schema';
import { recordEvent } from '@/lib/audit';
import { encryptSecret } from '@/lib/crypto';
import { verifySmtp } from '@/lib/email';
import { NotFound } from '@/lib/errors';
import { verifyImap } from '@/lib/imap';
import { requireActor } from '@/lib/session';
import type { ActionState } from '@/lib/action-state';

const orgSettingsInput = z.object({
  senderName: z.string().trim().min(1).max(120),
  senderAddress: z.string().trim().max(300).optional(),
  bookingLink: z.string().trim().max(500).optional(),
  notifyEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
  timezone: z.string().trim().min(1).max(60),
  openaiKey: z.string().trim().max(300).optional(),
  serperKey: z.string().trim().max(300).optional(),
});

export async function saveOrgSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const raw = Object.fromEntries(formData);
  const parsed = orgSettingsInput.safeParse({
    ...raw,
    senderAddress: String(raw['senderAddress'] ?? '') || undefined,
    bookingLink: String(raw['bookingLink'] ?? '') || undefined,
    notifyEmail: String(raw['notifyEmail'] ?? '') || undefined,
    openaiKey: String(raw['openaiKey'] ?? '') || undefined,
    serperKey: String(raw['serperKey'] ?? '') || undefined,
  });
  if (!parsed.success) return { error: 'Check the fields — sender name and a valid timezone are required.' };
  const input = parsed.data;

  try {
    Intl.DateTimeFormat(undefined, { timeZone: input.timezone });
  } catch {
    return { error: `"${input.timezone}" is not a valid IANA timezone (e.g. Australia/Sydney).` };
  }

  const set: Record<string, unknown> = {
    senderName: input.senderName,
    senderAddress: input.senderAddress ?? null,
    bookingLink: input.bookingLink ?? null,
    notifyEmail: input.notifyEmail || null,
    timezone: input.timezone,
    updatedAt: new Date(),
  };
  if (input.openaiKey) set['openaiKeyEnc'] = encryptSecret(input.openaiKey);
  if (input.serperKey) set['serperKeyEnc'] = encryptSecret(input.serperKey);

  await db()
    .insert(orgSettings)
    .values({ organizationId: actor.organizationId, ...set })
    .onConflictDoUpdate({ target: orgSettings.organizationId, set });

  revalidatePath('/settings');
  return { ok: true };
}

const mailboxInput = z.object({
  label: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  fromName: z.string().trim().min(1).max(120),
  smtpHost: z.string().trim().min(1).max(200),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.enum(['true', 'false']),
  smtpUser: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(300),
  imapHost: z.string().trim().min(1).max(200),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecure: z.enum(['true', 'false']),
  dailyCap: z.coerce.number().int().min(1).max(200),
});

export async function addMailboxAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const parsed = mailboxInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Fill in all mailbox fields (host, port, user, password).' };
  const input = parsed.data;

  const id = uuidv7();
  await db().insert(mailboxes).values({
    id,
    organizationId: actor.organizationId,
    label: input.label,
    email: input.email.toLowerCase(),
    fromName: input.fromName,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure === 'true',
    smtpUser: input.smtpUser,
    smtpSecretEnc: encryptSecret(input.password),
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecure: input.imapSecure === 'true',
    imapUser: input.smtpUser,
    imapSecretEnc: encryptSecret(input.password),
    dailyCap: input.dailyCap,
    warmupStartsAt: new Date(),
  });

  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'mailbox.connected',
    subjectType: 'mailbox',
    subjectId: id,
    metadata: { email: input.email },
  });

  revalidatePath('/settings');
  return { ok: true, fieldErrors: { mailboxId: id } };
}

export async function testMailboxAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const id = String(formData.get('mailboxId') ?? '');
  const [mailbox] = await db()
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, id), eq(mailboxes.organizationId, actor.organizationId)))
    .limit(1);
  if (!mailbox) throw new NotFound();

  try {
    await verifySmtp(mailbox);
    await verifyImap(mailbox);
    await db().update(mailboxes).set({ lastError: null }).where(eq(mailboxes.id, id));
    return { ok: true, fieldErrors: { result: 'SMTP and IMAP both connected.' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db().update(mailboxes).set({ lastError: message }).where(eq(mailboxes.id, id));
    return { error: `Connection failed: ${message}` };
  }
}

export async function archiveMailboxAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = String(formData.get('mailboxId') ?? '');
  await db()
    .update(mailboxes)
    .set({ archivedAt: new Date() })
    .where(and(eq(mailboxes.id, id), eq(mailboxes.organizationId, actor.organizationId)));
  revalidatePath('/settings');
}