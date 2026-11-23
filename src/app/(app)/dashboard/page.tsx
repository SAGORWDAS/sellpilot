import Link from 'next/link';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { ArrowRight, Plus } from 'lucide-react';
import { db } from '@/db';
import { apiUsage, campaigns, events, leads, projects } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Stat } from '@/components/ui';
import { formatDateTime, formatUsd } from '@/lib/utils';

export default async function DashboardPage() {
  const actor = await requireActor();
  const d = db();

  const [projectRows, leadCounts, campaignRows, spendRows, recentEvents] = await Promise.all([
    d
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, actor.organizationId), isNull(projects.archivedAt)))
      .orderBy(desc(projects.createdAt))
      .limit(6),
    d
      .select({ status: leads.status, n: count() })
      .from(leads)
      .where(eq(leads.organizationId, actor.organizationId))
      .groupBy(leads.status),
    d
      .select()
      .from(campaigns)
      .where(eq(campaigns.organizationId, actor.organizationId))
      .orderBy(desc(campaigns.createdAt))
      .limit(5),
    d
      .select({ total: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)` })
      .from(apiUsage)
      .where(eq(apiUsage.organizationId, actor.organizationId)),
    d
      .select()
      .from(events)
      .where(eq(events.organizationId, actor.organizationId))
      .orderBy(desc(events.at))
      .limit(8),
  ]);

  const byStatus = Object.fromEntries(leadCounts.map((r) => [r.status, r.n]));
  const activeCampaigns = campaignRows.filter((c) => c.status === 'active').length;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">Your pipeline at a glance.</p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4" /> New project
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Contacted" value={byStatus.contacted ?? 0} />
        <Stat label="Replies" value={(byStatus.replied ?? 0) + (byStatus.interested ?? 0) + (byStatus.closed ?? 0)} />
        <Stat label="Interested" value={(byStatus.interested ?? 0) + (byStatus.closed ?? 0)} />
        <Stat label="Closed" value={byStatus.closed ?? 0} />
        <Stat label="AI spend" value={formatUsd(Number(spendRows[0]?.total ?? 0))} hint={`${activeCampaigns} active campaign${activeCampaigns === 1 ? '' : 's'}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Projects</CardTitle>
              <Link href="/projects" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {projectRows.length === 0 ? (
                <EmptyState
                  title="No projects yet"
                  description="Throw in any URL — a service, an app, a store — and SellPilot builds the offer profile and sells it for you."
                >
                  <Link href="/projects/new">
                    <Button>
                      Create your first project <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </EmptyState>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {projectRows.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${p.id}`}
                          className="truncate text-sm font-medium text-zinc-900 hover:text-indigo-600"
                        >
                          {p.name}
                        </Link>
                        <p className="truncate text-xs text-zinc-500">{p.urls[0] ?? 'No URL'}</p>
                      </div>
                      <Badge tone="info">{p.type}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">Nothing yet. Launch a campaign.</p>
            ) : (
              <ul className="space-y-3">
                {recentEvents.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="text-zinc-800">{e.action.replaceAll('.', ' ')}</p>
                    <p className="text-xs text-zinc-400">{formatDateTime(e.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}