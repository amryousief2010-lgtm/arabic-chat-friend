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

  useEffect(() => {
    if (!loading && user && isDenied) {
      toast.error('لا تملكين صلاحية الدخول لهذه الصفحة', {
        description: 'تم تحويلك للصفحة الخاصة بكِ.',
      });
    }
  }, [loading, user, isDenied]);

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
    // Sales moderators: send to their own log page rather than the global dashboard.
    if (role === 'sales_moderator') {
      const mod = findModeratorByName(profile?.full_name);
      return <Navigate to={mod ? `/orders/moderator/${mod.slug}` : '/orders'} replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
