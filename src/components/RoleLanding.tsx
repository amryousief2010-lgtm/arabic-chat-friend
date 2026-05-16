import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getLandingForRole } from "@/constants/roleLandings";
import PageTransition from "@/components/layout/PageTransition";
import Index from "@/pages/Index";

/**
 * Smart landing for "/". Instead of mounting the manager dashboard and then
 * letting ProtectedRoute reject restricted roles (which would briefly flash a
 * permission toast), we look up the per-role landing target up-front and
 * redirect silently. Only roles whose landing IS "/" actually mount Index.
 */
const RoleLanding = () => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const target = getLandingForRole(role);
  if (target !== "/") {
    return <Navigate to={target} replace />;
  }

  return (
    <PageTransition>
      <Index />
    </PageTransition>
  );
};

export default RoleLanding;
