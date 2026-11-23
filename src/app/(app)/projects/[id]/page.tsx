import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ExternalLink, RefreshCw, Rocket } from 'lucide-react';
import { db } from '@/db';
import { campaigns, offerProfiles, projects } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { reanalyzeAction } from '@/app/(app)/projects/actions';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { formatDate } from '@/lib/utils';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const d = db();

  const [project] = await d
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.organizationId, actor.organizationId)))
    .limit(1);
  if (!project) notFound();

  const [offer] = await d
    .select()
    .from(offerProfiles)
    .where(eq(offerProfiles.projectId, project.id))
    .limit(1);

  const campaignRows = await d
    .select()
    .from(campaigns)
    .where(eq(campaigns.projectId, project.id))
    .orderBy(desc(campaigns.createdAt));

  const p = offer?.profile;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
            <Badge tone="info">{project.type}</Badge>
          </div>
          <a
            href={project.urls[0]}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-500"
          >
            {project.urls[0]} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          {offer ? (
            <Link href={`/projects/${project.id}/launch`}>
              <Button>
                <Rocket className="h-4 w-4" /> Launch campaign
              </Button>
            </Link>
          ) : null}
          <form action={reanalyzeAction}>
            <input type="hidden" name="projectId" value={project.id} />
            <Button type="submit" variant="secondary" size="sm">
              <RefreshCw className="h-4 w-4" /> Re-analyze
            </Button>
          </form>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Offer profile</CardTitle>
              {offer ? <span className="text-xs text-zinc-400">analyzed {formatDate(offer.analyzedAt)}</span> : null}
            </CardHeader>
            <CardContent>
              {!p ? (
                <p className="text-sm text-zinc-500">
                  Not analyzed yet. Run re-analyze (the worker must be running), or recreate the project.
                </p>
              ) : (
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="font-medium text-zinc-900">{p.tagline}</p>
                    <p className="mt-1 text-zinc-600">{p.description}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Audience</p>
                    <p className="mt-1 text-zinc-700">{p.targetAudience}</p>
                  </div>
                  {p.offerings.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Offerings</p>
                      <ul className="mt-1 space-y-1">
                        {p.offerings.map((o, i) => (
                          <li key={i} className="flex justify-between gap-4 text-zinc-700">
                            <span>{o.name}</span>
                            <span className="shrink-0 text-zinc-500">{o.price ?? ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {p.valueProps.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Value props</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-zinc-700">
                        {p.valueProps.map((v, i) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {p.proofPoints.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Proof</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-zinc-700">
                        {p.proofPoints.map((v, i) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              {campaignRows.length === 0 ? (
                <EmptyState
                  title="No campaigns yet"
                  description="A campaign finds leads, sends personalized emails and closes deals for this project."
                />
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {campaignRows.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="text-sm font-medium text-zinc-900 hover:text-indigo-600"
                      >
                        {c.name}
                      </Link>
                      <Badge
                        tone={
                          c.status === 'active'
                            ? 'success'
                            : c.status === 'paused'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {c.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Closing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Goal</p>
              <p className="mt-1 text-zinc-700">{project.goal.replaceAll('_', ' ')}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Close link</p>
              {project.closeLink ? (
                <a
                  href={project.closeLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate text-indigo-600 hover:text-indigo-500"
                >
                  {project.closeLink}
                </a>
              ) : (
                <p className="mt-1 text-zinc-500">None — the AI will ask for a reply or call.</p>
              )}
            </div>
            {project.closeNotes ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Notes</p>
                <p className="mt-1 text-zinc-700">{project.closeNotes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}