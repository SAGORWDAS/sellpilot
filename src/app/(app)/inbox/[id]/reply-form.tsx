'use client';

import { useActionState } from 'react';
import { Send } from 'lucide-react';
import { sendHumanReplyAction } from '@/app/(app)/inbox/actions';
import { initialActionState } from '@/lib/action-state';
import { Button, Textarea } from '@/components/ui';

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendHumanReplyAction, initialActionState);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Textarea
        name="body"
        rows={4}
        placeholder="Write a reply — sending manually pauses the AI on this thread."
        required
      />
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Sent.</p> : null}
      <Button type="submit" disabled={pending}>
        <Send className="h-4 w-4" /> {pending ? 'Sending…' : 'Send reply'}
      </Button>
    </form>
  );
}