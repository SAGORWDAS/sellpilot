'use client';

import { useActionState } from 'react';
import { saveOrgSettingsAction } from '@/app/(app)/settings/actions';
import { initialActionState } from '@/lib/action-state';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@/components/ui';

type Defaults = {
  senderName: string;
  senderAddress: string;
  bookingLink: string;
  notifyEmail: string;
  timezone: string;
  openaiConfigured: boolean;
  serperConfigured: boolean;
};

export function OrgSettingsForm({ defaults }: { defaults: Defaults }) {
  const [state, action, pending] = useActionState(saveOrgSettingsAction, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="senderName">Sender identity (name in email footers)</Label>
              <Input id="senderName" name="senderName" defaultValue={defaults.senderName} required />
            </div>
            <div>
              <Label htmlFor="senderAddress">Business address (compliance footer)</Label>
              <Input id="senderAddress" name="senderAddress" defaultValue={defaults.senderAddress} placeholder="123 Main St, Sydney NSW 2000" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="bookingLink">Default booking link</Label>
              <Input id="bookingLink" name="bookingLink" defaultValue={defaults.bookingLink} placeholder="https://cal.com/you/intro" />
            </div>
            <div>
              <Label htmlFor="notifyEmail">Hot-lead notifications to</Label>
              <Input id="notifyEmail" name="notifyEmail" type="email" defaultValue={defaults.notifyEmail} placeholder="you@yourdomain.com" />
            </div>
            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <Input id="timezone" name="timezone" defaultValue={defaults.timezone} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="openaiKey">
                OpenAI API key {defaults.openaiConfigured ? '(configured — leave blank to keep)' : ''}
              </Label>
              <Input id="openaiKey" name="openaiKey" type="password" placeholder={defaults.openaiConfigured ? '••••••••' : 'sk-…'} />
            </div>
            <div>
              <Label htmlFor="serperKey">
                Serper API key {defaults.serperConfigured ? '(configured — leave blank to keep)' : ''}
              </Label>
              <Input id="serperKey" name="serperKey" type="password" placeholder={defaults.serperConfigured ? '••••••••' : 'serper.dev key'} />
            </div>
          </div>
          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
          {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}