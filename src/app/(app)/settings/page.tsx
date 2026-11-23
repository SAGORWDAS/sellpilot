import { and, desc, eq, isNull } from 'drizzle-orm';
import { Trash2 } from 'lucide-react';
import { db } from '@/db';
import { mailboxes, orgSettings } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { archiveMailboxAction } from '@/app/(app)/settings/actions';
import { MailboxForm, MailboxTest } from '@/app/(app)/settings/mailbox-form';
import { OrgSettingsForm } from '@/app/(app)/settings/org-form';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

export default async function SettingsPage() {
  const actor = await requireActor();
  const d = db();

  const [settings] = await d
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, actor.organizationId))
    .limit(1);

  const mailboxRows = await d
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.organizationId, actor.organizationId), isNull(mailboxes.archivedAt)))
    .orderBy(desc(mailboxes.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Identity, keys and the mailbox that does the selling.</p>
      </div>

      <OrgSettingsForm
        defaults={{
          senderName: settings?.senderName ?? actor.name,
          senderAddress: settings?.senderAddress ?? '',
          bookingLink: settings?.bookingLink ?? '',
          notifyEmail: settings?.notifyEmail ?? '',
          timezone: settings?.timezone ?? 'Australia/Sydney',
          openaiConfigured: Boolean(settings?.openaiKeyEnc || process.env.OPENAI_API_KEY),
          serperConfigured: Boolean(settings?.serperKeyEnc || process.env.SERPER_API_KEY),
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Mailboxes</CardTitle>
        </CardHeader>
        <CardContent>
          {mailboxRows.length === 0 ? (
            <p className="text-sm text-zinc-500">No mailbox connected yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {mailboxRows.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900">
                      {m.label} <span className="font-normal text-zinc-500">· {m.email}</span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      cap {m.dailyCap}/day · last poll {formatDateTime(m.lastPollAt)}
                      {m.lastError ? <span className="text-red-600"> · {m.lastError.slice(0, 80)}</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.lastError ? <Badge tone="danger">error</Badge> : <Badge tone="success">ready</Badge>}
                    <MailboxTest mailboxId={m.id} />
                    <form action={archiveMailboxAction}>
                      <input type="hidden" name="mailboxId" value={m.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label="Remove mailbox">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <MailboxForm />
    </div>
  );
}