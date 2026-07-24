import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';

export function NotFound() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user?.role === 'admin' ? '/admin' : '/';
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="text-[40px] font-semibold tabular-nums text-line">404</div>
      <div className="text-body font-semibold text-ink">Page not found</div>
      <p className="max-w-sm text-meta text-muted">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Button variant="secondary" size="sm" onClick={() => navigate(home, { replace: true })}>
        Back to {user?.role === 'admin' ? 'dashboard' : 'workspace'}
      </Button>
    </div>
  );
}
