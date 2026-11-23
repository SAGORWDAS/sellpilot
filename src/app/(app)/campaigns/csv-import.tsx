'use client';

import { useActionState } from 'react';
import { Upload } from 'lucide-react';
import { importCsvAction } from '@/app/(app)/campaigns/actions';
import { initialActionState } from '@/lib/action-state';
import { Button, Input } from '@/components/ui';

export function CsvImport({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState(importCsvAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <Input
        type="file"
        name="file"
        accept=".csv,text/csv"
        className="h-9 w-auto max-w-56 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-zinc-100 file:px-2 file:py-1 file:text-xs"
        required
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        <Upload className="h-4 w-4" /> {pending ? 'Importing…' : 'Import CSV'}
      </Button>
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
      {state.fieldErrors?.summary ? (
        <span className="text-xs text-emerald-600">{state.fieldErrors.summary}</span>
      ) : null}
    </form>
  );
}