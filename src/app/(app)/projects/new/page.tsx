import { ProjectWizard } from './wizard';

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New project</h1>
        <p className="mt-1 text-sm text-zinc-500">Two steps. Then launch a campaign and it sells.</p>
      </div>
      <ProjectWizard />
    </div>
  );
}