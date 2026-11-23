'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { uuidv7 } from 'uuidv7';
import { db } from '@/db';
import { campaigns, conversations, leads, mailboxes, messages, orgSettings } from '@/db/schema';
import { recordEvent } from '@/lib/audit';
import { buildFooter, newMessageId, sendEmail } from '@/lib/email';
import { AppError, NotFound, ValidationError } from '@/lib/errors';
import { requireActor } from '@/lib/session';
import { shortRef } from '@/lib/tokens';
import type { ActionState } from '@/lib/action-state';

async function requireConversation(conversationId: string) {
  const actor = await requireActor();
  const [conversation] = await db()
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!conversation) throw new NotFound();
  return { actor, conversation };
}

export async function takeoverAction(formData: FormData): Promise<void> {
  const { actor, conversation } = await requireConversation(String(formData.get('conversationId') ?? ''));
  await db()
    .update(conversations)
    .set({ state: 'human_takeover', takeoverAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'conversation.takeover',
    subjectType: 'conversation',
    subjectId: conversation.id,
  });
  revalidatePath(`/inbox/${conversation.id}`);
}

export async function handBackAction(formData: FormData): Promise<void> {
  const { actor, conversation } = await requireConversation(String(formData.get('conversationId') ?? ''));
  await db()
    .update(conversations)
    .set({ state: 'ai_active', takeoverAt: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'conversation.handed_back',
    subjectType: 'conversation',
    subjectId: conversation.id,
  });
  revalidatePath(`/inbox/${conversation.id}`);
}

export async function markClosedAction(formData: FormData): Promise<void> {
  const { actor, conversation } = await requireConversation(String(formData.get('conversationId') ?? ''));
  const now = new Date();
  await db()
    .update(conversations)
    .set({ state: 'closed', closedAt: now, updatedAt: now })
    .where(eq(conversations.id, conversation.id));
  await db()
    .update(leads)
    .set({ status: 'closed', nextSendAt: null, updatedAt: now })
    .where(eq(leads.id, conversation.leadId));
  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'lead.closed',
    subjectType: 'lead',
    subjectId: conversation.leadId,
  });
  revalidatePath(`/inbox/${conversation.id}`);
}

export async function sendHumanReplyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { actor, conversation } = await requireConversation(String(formData.get('conversationId') ?? ''));
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return { error: 'Write a message first.' };
    if (body.length > 5000) return { error: 'Message too long.' };

    const [lead] = await db().select().from(leads).where(eq(leads.id, conversation.leadId)).limit(1);
    if (!lead?.email) throw new ValidationError('Lead has no email');
    const [campaign] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, conversation.campaignId))
      .limit(1);
    if (!campaign) throw new NotFound();
    const [mailbox] = await db().select().from(mailboxes).where(eq(mailboxes.id, campaign.mailboxId)).limit(1);
    if (!mailbox) throw new NotFound();
    const [settings] = await db()
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.organizationId, actor.organizationId))
      .limit(1);
    const [lastInbound] = await db()
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound')))
      .orderBy(desc(messages.at))
      .limit(1);

    const subject = lastInbound
      ? lastInbound.subject.toLowerCase().startsWith('re:')
        ? lastInbound.subject
        : `Re: ${lastInbound.subject}`
      : 'Following up';
    const messageId = newMessageId(mailbox.email);
    const replyToken = shortRef();
    const fullBody = body + buildFooter(settings?.senderName ?? mailbox.fromName, settings?.senderAddress ?? null);

    const msgId = uuidv7();
    await db().insert(messages).values({
      id: msgId,
      organizationId: actor.organizationId,
      campaignId: campaign.id,
      leadId: lead.id,
      direction: 'outbound',
      kind: 'reply',
      status: 'queued',
      messageId,
      inReplyTo: lastInbound?.messageId ?? null,
      replyToken,
      subject,
      body: fullBody,
    });

    await sendEmail(mailbox, {
      to: lead.email,
      subject,
      body: fullBody,
      messageId,
      inReplyTo: lastInbound?.messageId ?? null,
      replyToken,
    });

    const now = new Date();
    await db().update(messages).set({ status: 'sent', at: now }).where(eq(messages.id, msgId));
    await db()
      .update(conversations)
      .set({ state: 'human_takeover', takeoverAt: conversation.takeoverAt ?? now, updatedAt: now })
      .where(eq(conversations.id, conversation.id));

    revalidatePath(`/inbox/${conversation.id}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Send failed — check the mailbox connection in Settings.' };
  }
}