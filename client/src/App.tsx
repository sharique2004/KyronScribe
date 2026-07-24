import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Role } from '@/types';
import { useAuth } from '@/auth/AuthContext';
import { AppShell } from '@/components/AppShell';
import { Spinner } from '@/components/ui/Spinner';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { NotFound } from '@/pages/NotFound';
import { Workspace } from '@/pages/provider/Workspace';
import { EncounterList } from '@/pages/provider/EncounterList';
import { EncounterDetail } from '@/pages/provider/EncounterDetail';
import { AdminEncounters } from '@/pages/admin/AdminEncounters';
import { AdminProviders } from '@/pages/admin/AdminProviders';
import { AdminTemplates } from '@/pages/admin/AdminTemplates';

const homePath = (role: Role) => (role === 'admin' ? '/admin' : '/');

function BootSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page text-muted">
      <Spinner size={22} />
    </div>
  );
}

/** Public login route: redirect authenticated users to their home. */
function LoginGate() {
  const { user, booting } = useAuth();
  if (booting) return <BootSplash />;
  if (user) return <Navigate to={homePath(user.role)} replace />;
  return <Login />;
}

/** Public signup route: authenticated users are redirected to their home. */
function SignupGate() {
  const { user, booting } = useAuth();
  if (booting) return <BootSplash />;
  if (user) return <Navigate to={homePath(user.role)} replace />;
  return <Signup />;
}

/** Require an authenticated session; otherwise send to /login. Renders the shell. */
function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <BootSplash />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

/** Restrict a branch to one role; wrong-role users are bounced to their own home. */
function RoleGate({ role }: { role: Role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homePath(user.role)} replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route path="/signup" element={<SignupGate />} />

      <Route path="/" element={<Protected />}>
        {/* Provider workspace routes */}
        <Route element={<RoleGate role="provider" />}>
          <Route index element={<Workspace />} />
          <Route path="encounters" element={<EncounterList />} />
          <Route path="encounters/:id" element={<EncounterDetail />} />
        </Route>

        {/* Admin routes — admin lands on /admin */}
        <Route element={<RoleGate role="admin" />}>
          <Route path="admin" element={<AdminEncounters />} />
          <Route path="admin/providers" element={<AdminProviders />} />
          <Route path="admin/templates" element={<AdminTemplates />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
