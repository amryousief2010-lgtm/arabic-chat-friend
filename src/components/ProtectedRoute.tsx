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
  '/delivery-routes',
  '/private-courier',
  '/notifications',
  '/permissions',
  '/auth',
  '/install',
];

const SOCIAL_MEDIA_ALLOWED_PREFIXES = [
  '/orders',
  '/social-media',
  '/notifications',
  '/permissions',
  '/auth',
  '/install',
];

// Marketing Sales Manager (when it's the ONLY role, e.g. Mohamed Sayed):
// view-only marketing/reports scope. No orders create/edit, no warehouses,
// no treasury, no operational actions.
const MARKETING_ONLY_ALLOWED_PREFIXES = [
  '/social-media',
  '/reports',
  '/notifications',
  '/internal-messages',
  '/permissions',
  '/org-chart',
  '/auth',
  '/install',
];

const isPathAllowedForModerator = (pathname: string) =>
  MODERATOR_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const isPathAllowedForPrivateRep = (pathname: string) =>
  PRIVATE_REP_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const isPathAllowedForSocialMedia = (pathname: string) =>
  SOCIAL_MEDIA_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const isPathAllowedForMarketingOnly = (pathname: string) =>
  MARKETING_ONLY_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, role, roles, loading } = useAuth();
  const location = useLocation();
  const effectiveRoles = roles ?? (role ? [role] : []);

  // Users whose ONLY role is marketing_sales_manager get a strict read-only
  // marketing scope. Users who also hold sales_manager (or any other role)
  // are unaffected.
  const isMarketingOnly =
    effectiveRoles.length > 0 &&
    effectiveRoles.every((r) => r === 'marketing_sales_manager');

  // Sales moderators land on the org chart first, then navigate from there.
  const moderatorTarget =
    role === 'sales_moderator' ? '/orders' :
    role === 'private_delivery_rep' ? '/orders' :
    role === 'social_media_manager' ? '/social-media/daily' :
    isMarketingOnly ? '/social-media/marketing-dashboard' : '/';

  const isModeratorBlocked =
    (role === 'sales_moderator' && !isPathAllowedForModerator(location.pathname)) ||
    (role === 'private_delivery_rep' && !isPathAllowedForPrivateRep(location.pathname)) ||
    (role === 'social_media_manager' && !isPathAllowedForSocialMedia(location.pathname)) ||
    (isMarketingOnly && !isPathAllowedForMarketingOnly(location.pathname));
  // 2) Standard role check — pass if ANY of the user's roles is allowed.
  const isRoleDenied = !!(allowedRoles && !(effectiveRoles.some((r) => allowedRoles.includes(r))));
  const isDenied = isModeratorBlocked || isRoleDenied;

  useEffect(() => {
    if (!loading && user && isDenied) {
      // Silent redirect for private delivery rep and for moderators landing on root —
      // these are expected automatic landings, not real permission errors.
      const isSilentLanding =
        (role === 'private_delivery_rep') ||
        (role === 'social_media_manager') ||
        isMarketingOnly ||
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
    if (role === 'sales_moderator' || role === 'private_delivery_rep' || role === 'social_media_manager' || isMarketingOnly) {
      return <Navigate to={moderatorTarget} replace />;
    }
    return <Navigate to="/unauthorized" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
