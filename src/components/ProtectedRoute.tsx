import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, AppRole } from '@/hooks/useAuth';
import { findModeratorByName } from '@/constants/moderators';
import { toast } from 'sonner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, role, profile, loading } = useAuth();
  const location = useLocation();

  const isDenied = !!(allowedRoles && (!role || !allowedRoles.includes(role)));
  const moderatorTarget = role === 'sales_moderator'
    ? (() => {
        const m = findModeratorByName(profile?.full_name);
        return m ? `/orders/moderator/${m.slug}` : '/orders';
      })()
    : '/';

  useEffect(() => {
    if (!loading && user && isDenied) {
      const isDashboardAttempt = location.pathname === '/' || location.pathname.startsWith('/dashboard');
      toast.error('🚫 لا تملكين صلاحية الدخول لهذه الصفحة', {
        description: role === 'sales_moderator'
          ? `${isDashboardAttempt ? 'لوحة التحكم العمومية مخصّصة للإدارة فقط. ' : ''}تم تحويلك تلقائياً إلى سجل طلباتك الخاص: ${moderatorTarget}`
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
