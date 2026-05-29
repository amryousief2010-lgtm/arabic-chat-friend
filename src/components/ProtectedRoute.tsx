import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, AppRole } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

// Routes a sales_moderator is permitted to visit. Anything else gets
// hard-redirected to her own orders log with a clear toast.
const MODERATOR_ALLOWED_PREFIXES = [
  '/orders',
  '/chick-orders',
  '/sales-targets',
  '/notifications',
  '/permissions',
  '/private-delivery-pricing',
  '/org-chart',
  '/warehouse-stock',
  '/auth',
  '/install',
];

const PRIVATE_REP_ALLOWED_PREFIXES = [
  '/orders',
  '/private-delivery-pricing',
  '/notifications',
  '/permissions',
  '/auth',
  '/install',
];

const isPathAllowedForModerator = (pathname: string) =>
  MODERATOR_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const isPathAllowedForPrivateRep = (pathname: string) =>
  PRIVATE_REP_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  // Sales moderators land on the org chart first, then navigate from there.
  const moderatorTarget =
    role === 'sales_moderator' ? '/orders' :
    role === 'private_delivery_rep' ? '/orders' : '/';

  const isModeratorBlocked =
    (role === 'sales_moderator' && !isPathAllowedForModerator(location.pathname)) ||
    (role === 'private_delivery_rep' && !isPathAllowedForPrivateRep(location.pathname));
  // 2) Standard role check
  const isRoleDenied = !!(allowedRoles && (!role || !allowedRoles.includes(role)));
  const isDenied = isModeratorBlocked || isRoleDenied;

  useEffect(() => {
    if (!loading && user && isDenied) {
      // Silent redirect for private delivery rep and for moderators landing on root —
      // these are expected automatic landings, not real permission errors.
      const isSilentLanding =
        (role === 'private_delivery_rep') ||
        (role === 'sales_moderator' && (location.pathname === '/' || location.pathname.startsWith('/dashboard')));
      if (isSilentLanding) return;
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
    if (role === 'sales_moderator' || role === 'private_delivery_rep') {
      return <Navigate to={moderatorTarget} replace />;
    }
    return <Navigate to="/unauthorized" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
