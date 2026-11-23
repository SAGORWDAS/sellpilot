import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Plus } from 'lucide-react';
import { db } from '@/db';
import { offerProfiles, projects } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { formatDate } from '@/lib/utils';

export default async function ProjectsPage() {
  const actor = await requireActor();
  const rows = await db()
    .select({
      project: projects,
      analyzedAt: offerProfiles.analyzedAt,
    })
    .from(projects)
    .leftJoin(offerProfiles, eq(offerProfiles.projectId, projects.id))
    .where(and(eq(projects.organizationId, actor.organizationId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500">Everything you sell, in one place.</p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4" /> New project
          </Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Paste any URL — your web design service, a Play Store app, a Shopify store, a SaaS — and SellPilot learns the offer and sells it."
        >
          <Link href="/projects/new">
            <Button>Create your first project</Button>
          </Link>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ project: p, analyzedAt }) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="h-full p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-zinc-900">{p.name}</h3>
                  <Badge tone="info">{p.type}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{p.urls[0]}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                  <span>{p.goal.replaceAll('_', ' ')}</span>
                  {analyzedAt ? (
                    <Badge tone="success">analyzed {formatDate(analyzedAt)}</Badge>
                  ) : (
                    <Badge tone="warning">not analyzed</Badge>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}