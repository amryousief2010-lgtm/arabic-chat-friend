import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, AppRole } from '@/hooks/useAuth';
import { findModeratorByName } from '@/constants/moderators';
import { toast } from 'sonner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

// Routes a sales_moderator is permitted to visit. Anything else gets
// hard-redirected to her own orders log with a clear toast.
const MODERATOR_ALLOWED_PREFIXES = [
  '/orders',                  // covers /orders, /orders/new, /orders/:id, /orders/moderator/:slug
  '/sales-targets',
  '/modules/warehouses',      // read-only — write actions are gated in UI + DB
  '/notifications',
  '/permissions',
  '/org-chart',
  '/auth',
  '/install',
];

const isPathAllowedForModerator = (pathname: string) =>
  MODERATOR_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, role, profile, loading } = useAuth();
  const location = useLocation();

  const moderatorTarget = role === 'sales_moderator'
    ? (() => {
        const m = findModeratorByName(profile?.full_name);
        return m ? `/orders/moderator/${m.slug}` : '/orders';
      })()
    : '/';

  // 1) Hard moderator allowlist — even if a route forgot to set allowedRoles
  const isModeratorBlocked =
    role === 'sales_moderator' && !isPathAllowedForModerator(location.pathname);
  // 2) Standard role check
  const isRoleDenied = !!(allowedRoles && (!role || !allowedRoles.includes(role)));
  const isDenied = isModeratorBlocked || isRoleDenied;

  useEffect(() => {
    if (!loading && user && isDenied) {
      const isDashboardAttempt =
        location.pathname === '/' || location.pathname.startsWith('/dashboard');
      toast.error('🚫 لا تملكين صلاحية الدخول لهذه الصفحة', {
        description: role === 'sales_moderator'
          ? `${isDashboardAttempt ? 'لوحة التحكم العمومية مخصّصة للإدارة فقط. ' : 'هذه الصفحة غير متاحة لكِ. '}تم تحويلكِ تلقائياً إلى سجل طلباتكِ: ${moderatorTarget}`
          : 'تم تحويلك للصفحة الرئيسية.',
        duration: 6000,
      });
    }
  }, [loading, user, isDenied, location.pathname, role, moderatorTarget]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (isDenied) {
    if (role === 'sales_moderator') {
      return <Navigate to={moderatorTarget} replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
