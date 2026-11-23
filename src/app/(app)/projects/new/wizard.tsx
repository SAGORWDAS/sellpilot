'use client';

import { useActionState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  analyzeProjectAction,
  saveProjectAction,
  type WizardState,
} from '@/app/(app)/projects/actions';
import { Button, Card, Input, Label, Select, Textarea } from '@/components/ui';

const GOALS = [
  { value: 'book_call', label: 'Book a call' },
  { value: 'buy_product', label: 'Buy a product' },
  { value: 'install_app', label: 'Install an app' },
  { value: 'signup', label: 'Sign up / subscribe' },
  { value: 'other', label: 'Other' },
];

const TYPES = [
  { value: 'service', label: 'Service (e.g. web design)' },
  { value: 'app', label: 'Mobile app' },
  { value: 'store', label: 'Online store' },
  { value: 'saas', label: 'SaaS app' },
  { value: 'other', label: 'Other' },
];

export function ProjectWizard() {
  const [analyzeState, analyze, analyzing] = useActionState<WizardState, FormData>(
    analyzeProjectAction,
    {},
  );
  const [saveState, save, saving] = useActionState<WizardState, FormData>(saveProjectAction, {});

  if (analyzeState.profile && analyzeState.projectId) {
    const p = analyzeState.profile;
    return (
      <Card className="p-6">
        <StepHeader step={2} title="Review the offer" subtitle="The AI read the site. Fix anything that's off — this drives every email." />
        <form action={save} className="mt-6 space-y-4">
          <input type="hidden" name="projectId" value={analyzeState.projectId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Project name</Label>
              <Input id="name" name="name" defaultValue={p.businessName} required />
            </div>
            <div>
              <Label htmlFor="businessName">Business name (in emails)</Label>
              <Input id="businessName" name="businessName" defaultValue={p.businessName} required />
            </div>
          </div>
          <div>
            <Label htmlFor="tagline">Tagline</Label>
            <Input id="tagline" name="tagline" defaultValue={p.tagline} />
          </div>
          <div>
            <Label htmlFor="description">What you sell</Label>
            <Textarea id="description" name="description" rows={3} defaultValue={p.description} required />
          </div>
          <div>
            <Label htmlFor="targetAudience">Who buys it</Label>
            <Input id="targetAudience" name="targetAudience" defaultValue={p.targetAudience} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="valueProps">Value props (one per line)</Label>
              <Textarea id="valueProps" name="valueProps" rows={4} defaultValue={p.valueProps.join('\n')} />
            </div>
            <div>
              <Label htmlFor="proofPoints">Proof points (one per line)</Label>
              <Textarea id="proofPoints" name="proofPoints" rows={4} defaultValue={p.proofPoints.join('\n')} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="goal">Sales goal</Label>
              <Select id="goal" name="goal" defaultValue={analyzeState.goal ?? 'book_call'}>
                {GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="tone">Tone</Label>
              <Select id="tone" name="tone" defaultValue={p.tone}>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="direct">Direct</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="closeLink">Close link (booking / checkout / store)</Label>
            <Input id="closeLink" name="closeLink" placeholder="https://cal.com/you/intro or your checkout URL" />
          </div>
          <div>
            <Label htmlFor="closeNotes">Closing notes for the AI (optional)</Label>
            <Textarea id="closeNotes" name="closeNotes" rows={2} placeholder="e.g. Mention the 20% launch discount when they hesitate on price." />
          </div>
          {saveState.error ? <p className="text-sm text-red-600">{saveState.error}</p> : null}
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? 'Saving…' : 'Save project'}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <StepHeader step={1} title="What are we selling?" subtitle="Paste the URL. The AI reads the site and builds the offer profile." />
      <form action={analyze} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="url">Website / app / store URL</Label>
          <Input id="url" name="url" type="url" placeholder="https://your-business.com" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="type">Project type</Label>
            <Select id="type" name="type" defaultValue="service">
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="goal">Sales goal</Label>
            <Select id="goal" name="goal" defaultValue="book_call">
              {GOALS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="name">Project name (optional — AI fills it)</Label>
          <Input id="name" name="name" placeholder="Golden Lining Solution" />
        </div>
        {analyzeState.error ? <p className="text-sm text-red-600">{analyzeState.error}</p> : null}
        <Button type="submit" size="lg" disabled={analyzing}>
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the site…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> Analyze
            </>
          )}
        </Button>
        {analyzing ? (
          <p className="text-xs text-zinc-500">
            Crawling pages and extracting the offer. This usually takes a few seconds.
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
        {step}
      </span>
      <div>
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
      </div>
    </div>
  );
}