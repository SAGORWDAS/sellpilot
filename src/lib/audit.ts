import { uuidv7 } from 'uuidv7';
import type { Database } from '@/db';
import { events } from '@/db/schema';

export type EventInput = {
  organizationId: string;
  actorId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordEvent(db: Database, input: EventInput): Promise<void> {
  await db.insert(events).values({
    id: uuidv7(),
    organizationId: input.organizationId,
    actorId: input.actorId ?? null,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    metadata: input.metadata ?? null,
  });
}