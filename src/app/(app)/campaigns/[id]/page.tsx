import Link from 'next/link';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Search } from 'lucide-react';
import { db } from '@/db';
import { apiUsage, campaigns, leads, projects } from '@/db/schema';
import { requireActor } from '@/lib/session';
import {
  activateCampaignAction,
  findLeadsAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from '@/app/(app)/campaigns/actions';
import { CsvImport } from '@/app/(app)/campaigns/csv-import';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Stat } from '@/components/ui';
import { formatUsd } from '@/lib/utils';

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  discovered: 'neutral',
  audited: 'info',
  queued: 'info',
  contacted: 'warning',
  replied: 'success',
  interested: 'success',
  closed: 'success',
  suppressed: 'danger',
  bounced: 'danger',
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const d = db();

  const [campaign] = await d
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.organizationId, actor.organizationId)))
    .limit(1);
  if (!campaign) notFound();

  const [project] = await d
    .select()
    .from(projects)
    .where(eq(projects.id, campaign.projectId))
    .limit(1);

  const [statusCounts, leadRows, spendRows] = await Promise.all([
    d
      .select({ status: leads.status, n: count() })
      .from(leads)
      .where(eq(leads.campaignId, campaign.id))
      .groupBy(leads.status),
    d
      .select()
      .from(leads)
      .where(eq(leads.campaignId, campaign.id))
      .orderBy(desc(leads.createdAt))
      .limit(100),
    d
      .select({ total: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)` })
      .from(apiUsage)
      .where(eq(apiUsage.campaignId, campaign.id)),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r.n]));
  const total = statusCounts.reduce((sum, r) => sum + r.n, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
            <Badge tone={campaign.status === 'active' ? 'success' : campaign.status === 'paused' ? 'warning' : 'neutral'}>
              {campaign.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {project ? (
              <Link href={`/projects/${project.id}`} className="text-indigo-600 hover:text-indigo-500">
                {project.name}
              </Link>
            ) : null}{' '}
            · {campaign.dailyVolume} emails/day target
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === 'draft' && campaign.strategy ? (
            <form action={activateCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <Button type="submit">Launch</Button>
            </form>
          ) : null}
          {campaign.status === 'active' ? (
            <form action={pauseCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <Button type="submit" variant="secondary">
                Pause
              </Button>
            </form>
          ) : null}
          {campaign.status === 'paused' ? (
            <form action={resumeCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <Button type="submit">Resume</Button>
            </form>
          ) : null}
          <form action={findLeadsAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <Button type="submit" variant="secondary" disabled={!campaign.strategy} title={campaign.strategy ? '' : 'Build a strategy first'}>
              <Search className="h-4 w-4" /> Find leads
            </Button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Leads" value={total} />
        <Stat label="Contacted" value={byStatus.contacted ?? 0} />
        <Stat label="Replied" value={(byStatus.replied ?? 0) + (byStatus.interested ?? 0) + (byStatus.closed ?? 0)} />
        <Stat label="Interested" value={(byStatus.interested ?? 0) + (byStatus.closed ?? 0)} />
        <Stat label="Closed" value={byStatus.closed ?? 0} />
        <Stat
          label="AI spend"
          value={formatUsd(Number(spendRows[0]?.total ?? 0))}
          hint={`budget ${formatUsd(campaign.tokenBudgetUsd)}`}
        />
      </div>

      {campaign.strategy ? (
        <Card>
          <CardHeader>
            <CardTitle>Strategy</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ideal customer</p>
              <p className="mt-1 text-zinc-700">{campaign.strategy.icp}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Lead searches</p>
              <ul className="mt-1 space-y-0.5 text-zinc-600">
                {campaign.strategy.discoveryQueries.map((q, i) => (
                  <li key={i}>
                    <span className="text-zinc-400">{q.kind}:</span> {q.query}
                    {q.location ? ` — ${q.location}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Sample opener</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-sans text-xs text-zinc-700">
                {`Subject: ${campaign.strategy.sampleEmail.subject}\n\n${campaign.strategy.sampleEmail.body}`}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Leads</CardTitle>
          <CsvImport campaignId={campaign.id} />
        </CardHeader>
        <CardContent>
          {leadRows.length === 0 ? (
            <EmptyState
              title="No leads yet"
              description={
                campaign.strategy
                  ? 'Hit "Find leads" — the scout searches Google, audits each website and finds published business emails. Or import a CSV.'
                  : 'Launch setup builds the strategy, then the scout can find leads. You can also import a CSV right now.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400">
                    <th className="py-2 pr-4 font-medium">Business</th>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Hook</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {leadRows.map((l) => (
                    <tr key={l.id}>
                      <td className="max-w-48 truncate py-2.5 pr-4 font-medium text-zinc-900">
                        {l.website ? (
                          <a href={l.website} target="_blank" rel="noreferrer" className="hover:text-indigo-600">
                            {l.businessName}
                          </a>
                        ) : (
                          l.businessName
                        )}
                      </td>
                      <td className="max-w-52 truncate py-2.5 pr-4 text-zinc-600">{l.email ?? '—'}</td>
                      <td className="max-w-64 truncate py-2.5 pr-4 text-zinc-500">{l.hook ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-zinc-500">{l.source}</td>
                      <td className="py-2.5">
                        <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{l.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > leadRows.length ? (
                <p className="mt-3 text-xs text-zinc-400">Showing latest {leadRows.length} of {total}.</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}