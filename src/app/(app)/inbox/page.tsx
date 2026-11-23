import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaigns, conversations, leads } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

const CATEGORY_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  interested: 'success',
  question: 'info',
  objection: 'warning',
  not_interested: 'neutral',
  out_of_office: 'neutral',
  unsubscribe: 'danger',
  bounce: 'danger',
  other: 'neutral',
};

export default async function InboxPage() {
  const actor = await requireActor();
  const rows = await db()
    .select({
      conversation: conversations,
      lead: leads,
      campaignName: campaigns.name,
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .innerJoin(campaigns, eq(campaigns.id, conversations.campaignId))
    .where(eq(conversations.organizationId, actor.organizationId))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every conversation the AI is having. Take over any of them.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversations</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="When leads reply, the AI answers and the threads show up here."
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {rows.map(({ conversation: c, lead: l, campaignName }) => (
                <li key={c.id}>
                  <Link
                    href={`/inbox/${c.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{l.businessName}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {campaignName} · {formatDateTime(c.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.lastCategory ? (
                        <Badge tone={CATEGORY_TONE[c.lastCategory] ?? 'neutral'}>
                          {c.lastCategory.replaceAll('_', ' ')}
                        </Badge>
                      ) : null}
                      <Badge
                        tone={
                          c.state === 'ai_active'
                            ? 'info'
                            : c.state === 'human_takeover'
                              ? 'warning'
                              : c.state === 'closed'
                                ? 'success'
                                : 'danger'
                        }
                      >
                        {c.state === 'ai_active' ? 'AI' : c.state.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}