import { and, count, eq, gte, inArray } from 'drizzle-orm';
import type { Database } from '@/db';
import { campaigns, messages } from '@/db/schema';
import type { Campaign, Mailbox } from '@/db/schema';

export function warmupCap(warmupStartsAt: Date, now: Date): number {
  const day = Math.floor((now.getTime() - warmupStartsAt.getTime()) / 86_400_000);
  if (day < 3) return 5;
  if (day < 7) return 10;
  if (day < 14) return 20;
  return 40;
}

export function effectiveDailyCap(mailbox: Mailbox, campaign: Campaign, now: Date): number {
  return Math.min(warmupCap(mailbox.warmupStartsAt, now), mailbox.dailyCap, campaign.dailyVolume);
}

function localParts(date: Date, timeZone: string): { weekday: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { weekday: parts['weekday'] ?? 'Mon', hour: Number(parts['hour'] ?? 12) };
}

export function nextSendWindow(from: Date, timeZone: string, jitterMs = 0): Date {
  let t = new Date(from);
  for (let i = 0; i < 200; i++) {
    const { weekday, hour } = localParts(t, timeZone);
    if (weekday !== 'Sat' && weekday !== 'Sun' && hour >= 9 && hour < 17) {
      return new Date(t.getTime() + jitterMs);
    }
    t = new Date(t.getTime() + 30 * 60_000);
  }
  return new Date(from.getTime() + jitterMs);
}

export function jitter(maxMinutes: number): number {
  return Math.floor(Math.random() * maxMinutes * 60_000);
}

export async function outboundCountToday(db: Database, mailboxId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .where(
      and(
        eq(campaigns.mailboxId, mailboxId),
        eq(messages.direction, 'outbound'),
        inArray(messages.status, ['queued', 'sent']),
        gte(messages.at, startOfDay),
      ),
    );
  return row?.n ?? 0;
}