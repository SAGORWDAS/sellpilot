import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ArrowLeft, Bot, CheckCircle2, User } from 'lucide-react';
import { db } from '@/db';
import { conversations, leads, messages } from '@/db/schema';
import { requireActor } from '@/lib/session';
import { handBackAction, markClosedAction, takeoverAction } from '@/app/(app)/inbox/actions';
import { ReplyForm } from './reply-form';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { cn, formatDateTime } from '@/lib/utils';

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const d = db();

  const [conversation] = await d
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.organizationId, actor.organizationId)))
    .limit(1);
  if (!conversation) notFound();

  const [lead] = await d.select().from(leads).where(eq(leads.id, conversation.leadId)).limit(1);
  if (!lead) notFound();

  const thread = await d
    .select()
    .from(messages)
    .where(eq(messages.leadId, lead.id))
    .orderBy(asc(messages.at))
    .limit(100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/inbox" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" /> Inbox
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{lead.businessName}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {lead.email} · lead status {lead.status}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {conversation.state === 'ai_active' ? (
              <form action={takeoverAction}>
                <input type="hidden" name="conversationId" value={conversation.id} />
                <Button type="submit" variant="secondary" size="sm">
                  <User className="h-4 w-4" /> Take over
                </Button>
              </form>
            ) : conversation.state === 'human_takeover' ? (
              <form action={handBackAction}>
                <input type="hidden" name="conversationId" value={conversation.id} />
                <Button type="submit" variant="secondary" size="sm">
                  <Bot className="h-4 w-4" /> Hand back to AI
                </Button>
              </form>
            ) : null}
            {conversation.state !== 'closed' && conversation.state !== 'suppressed' ? (
              <form action={markClosedAction}>
                <input type="hidden" name="conversationId" value={conversation.id} />
                <Button type="submit" size="sm">
                  <CheckCircle2 className="h-4 w-4" /> Mark closed
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {thread.map((m) => (
          <div
            key={m.id}
            className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}
          >
            <Card
              className={cn(
                'max-w-[85%] px-4 py-3',
                m.direction === 'outbound' ? 'bg-indigo-50/60 border-indigo-100' : 'bg-white',
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-medium">
                  {m.direction === 'outbound' ? (m.kind === 'reply' || m.kind === 'close' ? 'Reply' : m.kind) : 'Them'}
                </span>
                <span>{formatDateTime(m.at)}</span>
                {m.category ? <Badge tone="info">{m.category.replaceAll('_', ' ')}</Badge> : null}
                {m.status === 'failed' ? <Badge tone="danger">failed</Badge> : null}
              </div>
              <p className="text-xs font-medium text-zinc-700">{m.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{m.body}</p>
            </Card>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {conversation.state === 'ai_active'
              ? 'AI is handling this thread'
              : conversation.state === 'human_takeover'
                ? 'You are handling this thread'
                : `Thread ${conversation.state}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {conversation.state === 'suppressed' ? (
            <p className="text-sm text-zinc-500">
              This address is suppressed — no further emails will be sent.
            </p>
          ) : (
            <ReplyForm conversationId={conversation.id} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}