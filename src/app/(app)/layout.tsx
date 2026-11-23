import Link from 'next/link';
import { FolderKanban, Inbox, LayoutDashboard, LogOut, Rocket, Settings } from 'lucide-react';
import { requireActor } from '@/lib/session';
import { logoutAction } from '@/app/auth-actions';
import { Button } from '@/components/ui';
import { NavLink } from '@/components/nav-link';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-zinc-100 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Rocket className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight">SellPilot</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
          ))}
        </nav>
        <div className="border-t border-zinc-100 px-5 py-4">
          <p className="truncate text-sm font-medium text-zinc-900">{actor.name}</p>
          <p className="truncate text-xs text-zinc-500">{actor.email}</p>
          <form action={logoutAction} className="mt-3">
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-zinc-200 bg-white px-4 md:hidden">
          <span className="mr-2 flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Rocket className="h-4 w-4" />
          </span>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}