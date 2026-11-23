'use client';

import { useActionState, useState } from 'react';
import { Globe, Loader2, MapPin, RefreshCw, Rocket } from 'lucide-react';
import {
  activateCampaignAction,
  createCampaignAction,
  regenerateStrategyAction,
  type LaunchState,
} from '@/app/(app)/campaigns/actions';
import { Button, Card, Input, Label, Select, Textarea } from '@/components/ui';

type MailboxOption = { id: string; label: string; email: string };

export function LaunchWizard({
  projectId,
  projectName,
  mailboxes,
}: {
  projectId: string;
  projectName: string;
  mailboxes: MailboxOption[];
}) {
  const [createState, create, creating] = useActionState<LaunchState, FormData>(
    createCampaignAction,
    {},
  );
  const [regenState, regen, regenerating] = useActionState<LaunchState, FormData>(
    regenerateStrategyAction,
    {},
  );
  const [mode, setMode] = useState<'local' | 'generic'>('local');
  const [volume, setVolume] = useState(20);

  const state = regenState.strategy ? regenState : createState;

  if (state.strategy && state.campaignId) {
    const s = state.strategy;
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
            2
          </span>
          <div>
            <h2 className="text-base font-semibold">Review the plan, then launch</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              Once launched, the scout finds leads and the pipeline runs on its own.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ideal customer</p>
            <p className="mt-1 text-zinc-800">{s.icp}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Lead searches</p>
            <ul className="mt-1 space-y-0.5 text-zinc-700">
              {s.discoveryQueries.map((q, i) => (
                <li key={i}>
                  <span className="text-zinc-400">{q.kind}:</span> {q.query}
                  {q.location ? ` — ${q.location}` : ''}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Sample opener</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-sans text-sm text-zinc-800">
              {`Subject: ${s.sampleEmail.subject}\n\n${s.sampleEmail.body}`}
            </pre>
          </div>
        </div>

        {regenState.error ? <p className="mt-3 text-sm text-red-600">{regenState.error}</p> : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <form action={activateCampaignAction}>
            <input type="hidden" name="campaignId" value={state.campaignId} />
            <Button type="submit" size="lg">
              <Rocket className="h-4 w-4" /> Launch campaign
            </Button>
          </form>
          <form action={regen}>
            <input type="hidden" name="campaignId" value={state.campaignId} />
            <Button type="submit" variant="secondary" disabled={regenerating}>
              {regenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}{' '}
              Regenerate
            </Button>
          </form>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
          1
        </span>
        <div>
          <h2 className="text-base font-semibold">Who should we sell to?</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Selling: {projectName}</p>
        </div>
      </div>

      <form action={create} className="mt-6 space-y-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="mode" value={mode} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Campaign name</Label>
            <Input id="name" name="name" defaultValue={`${projectName} — outbound`} required />
          </div>
          <div>
            <Label htmlFor="mailboxId">Send from</Label>
            <Select id="mailboxId" name="mailboxId" required>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.email})
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label>Audience type</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'local' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMode('local')}
            >
              <MapPin className="h-3.5 w-3.5" /> Local businesses
            </Button>
            <Button
              type="button"
              variant={mode === 'generic' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMode('generic')}
            >
              <Globe className="h-3.5 w-3.5" /> Anything else
            </Button>
          </div>
        </div>

        {mode === 'local' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="niche">Niche</Label>
              <Input id="niche" name="niche" placeholder="plumbers, dentists, cafés…" />
            </div>
            <div>
              <Label htmlFor="location">Location</Label>
              <Input id="location" name="location" placeholder="Sydney NSW, Australia" />
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="description">Describe the audience</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder="e.g. Shopify store owners doing 50+ orders/day who struggle with abandoned carts"
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="dailyVolume">Emails per day: {volume}</Label>
            <input
              id="dailyVolume"
              name="dailyVolume"
              type="range"
              min={5}
              max={40}
              step={5}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <p className="mt-1 text-xs text-zinc-500">Warmup still applies: a new mailbox starts at 5/day.</p>
          </div>
          <div>
            <Label htmlFor="budget">AI budget (USD)</Label>
            <Input id="budget" name="budget" type="number" min={1} max={100} defaultValue={5} required />
            <p className="mt-1 text-xs text-zinc-500">Hard cap on OpenAI + search spend for this campaign.</p>
          </div>
        </div>

        {createState.error ? <p className="text-sm text-red-600">{createState.error}</p> : null}
        <Button type="submit" size="lg" disabled={creating}>
          {creating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Building the strategy…
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" /> Build strategy
            </>
          )}
        </Button>
      </form>
    </Card>
  );
}