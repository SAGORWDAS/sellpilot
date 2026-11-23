'use client';

import { useActionState, useState } from 'react';
import { Mail, Plug } from 'lucide-react';
import { addMailboxAction, testMailboxAction } from '@/app/(app)/settings/actions';
import { initialActionState } from '@/lib/action-state';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@/components/ui';

const PRESETS: Record<string, { smtpHost: string; smtpPort: number; smtpSecure: boolean; imapHost: string; imapPort: number; imapSecure: boolean }> = {
  hostinger: { smtpHost: 'smtp.hostinger.com', smtpPort: 465, smtpSecure: true, imapHost: 'imap.hostinger.com', imapPort: 993, imapSecure: true },
  google: { smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true },
  outlook: { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false, imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true },
};

export function MailboxForm() {
  const [state, action, pending] = useActionState(addMailboxAction, initialActionState);
  const [preset, setPreset] = useState('hostinger');
  const p = PRESETS[preset];

  if (state.ok) {
    return <MailboxTest mailboxId={state.fieldErrors?.mailboxId ?? ''} justAdded />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-indigo-600" /> Connect a mailbox
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" placeholder="Sales mailbox" required />
            </div>
            <div>
              <Label htmlFor="email">Email address</Label>
              <Input id="email" name="email" type="email" placeholder="sales@yourdomain.com" required />
            </div>
            <div>
              <Label htmlFor="fromName">From name</Label>
              <Input id="fromName" name="fromName" placeholder="Dave — Golden Lining" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="preset">Provider preset</Label>
              <Select id="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="hostinger">Hostinger</option>
                <option value="google">Google Workspace</option>
                <option value="outlook">Outlook / Microsoft 365</option>
                <option value="custom">Custom</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="smtpUser">Username</Label>
              <Input id="smtpUser" name="smtpUser" placeholder="sales@yourdomain.com" required />
            </div>
            <div>
              <Label htmlFor="password">Password / app password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="smtpHost">SMTP host</Label>
              <Input id="smtpHost" name="smtpHost" defaultValue={p?.smtpHost ?? ''} key={`sh-${preset}`} required />
            </div>
            <div>
              <Label htmlFor="smtpPort">SMTP port</Label>
              <Input id="smtpPort" name="smtpPort" type="number" defaultValue={p?.smtpPort ?? 465} key={`sp-${preset}`} required />
            </div>
            <div>
              <Label htmlFor="imapHost">IMAP host</Label>
              <Input id="imapHost" name="imapHost" defaultValue={p?.imapHost ?? ''} key={`ih-${preset}`} required />
            </div>
            <div>
              <Label htmlFor="imapPort">IMAP port</Label>
              <Input id="imapPort" name="imapPort" type="number" defaultValue={p?.imapPort ?? 993} key={`ip-${preset}`} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="smtpSecure">SMTP security</Label>
              <Select id="smtpSecure" name="smtpSecure" defaultValue={String(p?.smtpSecure ?? true)} key={`ss-${preset}`}>
                <option value="true">SSL/TLS (465)</option>
                <option value="false">STARTTLS (587)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="imapSecure">IMAP security</Label>
              <Select id="imapSecure" name="imapSecure" defaultValue={String(p?.imapSecure ?? true)} key={`is-${preset}`}>
                <option value="true">SSL/TLS (993)</option>
                <option value="false">STARTTLS (143)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="dailyCap">Max emails/day (after warmup)</Label>
              <Input id="dailyCap" name="dailyCap" type="number" min={1} max={200} defaultValue={40} required />
            </div>
          </div>
          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            <Plug className="h-4 w-4" /> {pending ? 'Saving…' : 'Add mailbox'}
          </Button>
          <p className="text-xs text-zinc-500">
            Credentials are encrypted at rest. New mailboxes warm up automatically: 5/day → 10 → 20 → 40.
            Google/Outlook need an app password.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function MailboxTest({ mailboxId, justAdded = false }: { mailboxId: string; justAdded?: boolean }) {
  const [state, action, pending] = useActionState(testMailboxAction, initialActionState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="mailboxId" value={mailboxId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Testing…' : 'Test connection'}
      </Button>
      {justAdded && !state.ok && !state.error ? (
        <span className="text-xs text-emerald-600">Mailbox added.</span>
      ) : null}
      {state.fieldErrors?.result ? (
        <span className="text-xs text-emerald-600">{state.fieldErrors.result}</span>
      ) : null}
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
    </form>
  );
}