import { describe, expect, it } from 'vitest';
import { effectiveDailyCap, nextSendWindow, warmupCap } from '../src/lib/sending';
import type { Campaign, Mailbox } from '../src/db/schema';

const DAY = 86_400_000;

describe('warmupCap', () => {
  it('ramps 5 → 10 → 20 → 40 over two weeks', () => {
    const start = new Date('2026-11-01T00:00:00Z');
    expect(warmupCap(start, start)).toBe(5);
    expect(warmupCap(start, new Date(start.getTime() + 2 * DAY))).toBe(5);
    expect(warmupCap(start, new Date(start.getTime() + 3 * DAY))).toBe(10);
    expect(warmupCap(start, new Date(start.getTime() + 7 * DAY))).toBe(20);
    expect(warmupCap(start, new Date(start.getTime() + 14 * DAY))).toBe(40);
  });
});

describe('effectiveDailyCap', () => {
  it('takes the minimum of warmup, mailbox cap and campaign volume', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const mailbox = {
      warmupStartsAt: new Date(now.getTime() - 30 * DAY),
      dailyCap: 15,
    } as Mailbox;
    const campaign = { dailyVolume: 30 } as Campaign;
    expect(effectiveDailyCap(mailbox, campaign, now)).toBe(15);
  });
});

describe('nextSendWindow', () => {
  it('keeps a time already inside Sydney business hours', () => {
    // Mon 23 Nov 2026 09:00 Sydney (AEDT, UTC+11)
    const inside = new Date('2026-11-22T22:00:00Z');
    expect(nextSendWindow(inside, 'Australia/Sydney', 0).getTime()).toBe(inside.getTime());
  });

  it('moves Friday night to Monday morning', () => {
    // Fri 20 Nov 2026 21:00 Sydney
    const fridayNight = new Date('2026-11-20T10:00:00Z');
    const next = nextSendWindow(fridayNight, 'Australia/Sydney', 0);
    // Mon 23 Nov 2026 09:00 Sydney
    expect(next.getTime()).toBe(new Date('2026-11-22T22:00:00Z').getTime());
  });

  it('moves early morning to 9am same day', () => {
    // Mon 23 Nov 2026 06:00 Sydney
    const early = new Date('2026-11-22T19:00:00Z');
    const next = nextSendWindow(early, 'Australia/Sydney', 0);
    expect(next.getTime()).toBe(new Date('2026-11-22T22:00:00Z').getTime());
  });
});