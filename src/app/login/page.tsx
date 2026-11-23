'use client';

import { useActionState } from 'react';
import { Rocket } from 'lucide-react';
import { loginAction } from '@/app/auth-actions';
import { initialActionState } from '@/lib/action-state';
import { Button, Card, Input, Label } from '@/components/ui';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initialActionState);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Rocket className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">SellPilot</span>
        </div>
        <Card className="p-6">
          <h1 className="text-base font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-500">Your autonomous sales engine.</p>
          <form action={action} className="mt-5 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}