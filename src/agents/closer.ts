import type { Database } from '@/db';
import type { Lead, Mailbox, Project } from '@/db/schema';
import { orgSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { recordEvent } from '@/lib/audit';
import { sendEmail, newMessageId } from '@/lib/email';
import { shortRef } from '@/lib/tokens';

type Settings = typeof orgSettings.$inferSelect;

export function closeSnippet(project: Project, settings: Settings | null): string {
  const url = project.closeLink || settings?.bookingLink || null;
  const notes = project.closeNotes ? ` ${project.closeNotes}` : '';
  if (!url) {
    return `No link configured — propose a quick reply with two suggested times instead.${notes}`;
  }
  switch (project.goal) {
    case 'book_call':
      return `Offer the booking link: ${url} — "grab any slot that suits you".${notes}`;
    case 'buy_product':
      return `Offer the purchase link: ${url} — keep it low-pressure, one sentence.${notes}`;
    case 'install_app':
      return `Offer the app link: ${url} — mention it takes under a minute to try.${notes}`;
    case 'signup':
      return `Offer the signup link: ${url} — mention what they get immediately after signing up.${notes}`;
    default:
      return `Offer this link: ${url}.${notes}`;
  }
}

export async function notifyHotLead(
  d: Database,
  mailbox: Mailbox,
  settings: Settings | null,
  lead: Lead,
  summary: string,
): Promise<void> {
  await recordEvent(d, {
    organizationId: lead.organizationId,
    action: 'lead.interested',
    subjectType: 'lead',
    subjectId: lead.id,
    metadata: { business: lead.businessName, summary },
  });

  if (!settings?.notifyEmail) return;
  try {
    await sendEmail(mailbox, {
      to: settings.notifyEmail,
      subject: `Hot lead: ${lead.businessName}`,
      body: `${lead.businessName} replied with interest.\n\n${summary}\n\nOpen the inbox in SellPilot to watch the conversation.`,
      messageId: newMessageId(mailbox.email),
      replyToken: shortRef(),
    });
  } catch (err) {
    console.error('[closer] hot-lead notification failed', err);
  }
}