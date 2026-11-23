import Link from 'next/link';
import { and, eq, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { mailboxes, offerProfiles, projects } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { LaunchWizard } from './wizard';
import { Button, EmptyState } from '@/components/ui';

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
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

  const mailboxRows = await d
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.organizationId, actor.organizationId), isNull(mailboxes.archivedAt)));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Launch a campaign</h1>
        <p className="mt-1 text-sm text-zinc-500">A few inputs. Then it runs itself.</p>
      </div>

      {mailboxRows.length === 0 ? (
        <EmptyState
          title="Connect a mailbox first"
          description="Outreach sends from your own mailbox — that's what keeps it landing in inboxes."
        >
          <Link href="/settings">
            <Button>Connect mailbox</Button>
          </Link>
        </EmptyState>
      ) : !offer ? (
        <EmptyState
          title="Analyze the offer first"
          description="The strategy needs the offer profile. Run re-analyze on the project page."
        >
          <Link href={`/projects/${project.id}`}>
            <Button variant="secondary">Back to project</Button>
          </Link>
        </EmptyState>
      ) : (
        <LaunchWizard
          projectId={project.id}
          projectName={project.name}
          mailboxes={mailboxRows.map((m) => ({ id: m.id, label: m.label, email: m.email }))}
        />
      )}
    </div>
  );
}