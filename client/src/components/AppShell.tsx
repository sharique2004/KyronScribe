import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/components/ui/cn';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const icons = {
  newEncounter: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
      <rect x="4" y="3" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 7.5v5M7.5 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  list: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
      <path d="M6 6h9M6 10h9M6 14h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="3.5" cy="6" r="0.9" fill="currentColor" />
      <circle cx="3.5" cy="10" r="0.9" fill="currentColor" />
      <circle cx="3.5" cy="14" r="0.9" fill="currentColor" />
    </svg>
  ),
  encounters: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
      <rect x="4" y="3.5" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  providers: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 16c0-2.8 2.5-4.5 5.5-4.5s5.5 1.7 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  templates: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
      <rect x="3.5" y="4" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 8h13M8 8v8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
};

const providerNav: NavItem[] = [
  { to: '/', label: 'New Encounter', icon: icons.newEncounter, end: true },
  { to: '/encounters', label: 'My Encounters', icon: icons.list },
];

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Encounters', icon: icons.encounters, end: true },
  { to: '/admin/providers', label: 'Providers', icon: icons.providers },
  { to: '/admin/templates', label: 'Templates', icon: icons.templates },
];

function Wordmark() {
  return (
    <div className="flex items-center gap-2 select-none">
      <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-white">
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
          <path d="M10 8v16M10 16h5.2M22 8v16" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M15.2 16l6.8-8M15.2 16l6.8 8" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-[15px] text-ink">
        Kyron<span className="font-semibold">Scribe</span>
      </span>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded border border-transparent px-1.5 py-1 hover:bg-page"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#EAF0FC] text-[11px] font-semibold text-primary">
          {initials(user.fullName)}
        </span>
        <span className="hidden text-body font-medium text-ink sm:block">{user.fullName}</span>
        <Badge tone={user.role === 'admin' ? 'primary' : 'neutral'}>
          {user.role === 'admin' ? 'Admin' : 'Provider'}
        </Badge>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-muted">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded border border-line bg-surface py-1 shadow-menu">
          <div className="border-b border-line px-3 py-2">
            <div className="truncate text-body font-medium text-ink">{user.fullName}</div>
            <div className="truncate text-meta text-muted">{user.email}</div>
          </div>
          <button
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login', { replace: true });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink hover:bg-page"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" className="text-muted">
              <path d="M8 5.5V4a1.5 1.5 0 0 1 1.5-1.5H15A1.5 1.5 0 0 1 16.5 4v12A1.5 1.5 0 0 1 15 17.5H9.5A1.5 1.5 0 0 1 8 16v-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 10h8M8 7l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.replace(/,.*/, '').trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Shell: slim top bar + role-aware left rail + max-w-1200 content (PRD §7.1). */
export function AppShell() {
  const { user } = useAuth();
  const [mock, setMock] = useState(false);
  const nav = user?.role === 'admin' ? adminNav : providerNav;

  // Environment chip: reflect server mock-scribe mode (P5) when the health
  // endpoint reports it. Absent field ⇒ no chip. Forward-compatible.
  useEffect(() => {
    api
      .get<{ mock?: boolean }>('/health')
      .then((h) => setMock(Boolean(h.mock)))
      .catch(() => setMock(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="no-print sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <Wordmark />
        <div className="flex items-center gap-3">
          {mock && (
            <Badge tone="warning" dot title="Generation is running from canned demo data (SCRIBE_MOCK)">
              Mock mode
            </Badge>
          )}
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="no-print sticky top-12 h-[calc(100vh-3rem)] w-52 shrink-0 border-r border-line bg-surface px-2.5 py-3">
          <nav className="flex flex-col gap-0.5">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded px-2.5 py-1.5 text-body font-medium transition-colors',
                    isActive
                      ? 'bg-[#EAF0FC] text-primary'
                      : 'text-muted hover:bg-page hover:text-ink',
                  )
                }
              >
                <span className="shrink-0">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-content px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
