import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'general_manager' | 'executive_manager' | 'sales_manager' | 'sales_moderator' | 'accountant' | 'warehouse_supervisor';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  // Role checks
  isGeneralManager: boolean;
  isExecutiveManager: boolean;
  isSalesManager: boolean;
  isSalesModerator: boolean;
  isAccountant: boolean;
  isWarehouseSupervisor: boolean;
  // Permission helpers
  canManageEmployees: boolean;
  canManageProducts: boolean;
  canManageOrders: boolean;
  canViewReports: boolean;
  canUpdatePaymentStatus: boolean;
  canUpdateOrderStatus: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching role:', error);
        return null;
      }
      
      return data?.role as AppRole | null;
    } catch (error) {
      console.error('Error fetching role:', error);
      return null;
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Defer role fetch with setTimeout to prevent deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchUserRole(session.user.id).then(setRole);
          }, 0);
        } else {
          setRole(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchUserRole(session.user.id).then(userRole => {
          setRole(userRole);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
  };

  // Role checks
  const isGeneralManager = role === 'general_manager';
  const isExecutiveManager = role === 'executive_manager';
  const isSalesManager = role === 'sales_manager';
  const isSalesModerator = role === 'sales_moderator';
  const isAccountant = role === 'accountant';
  const isWarehouseSupervisor = role === 'warehouse_supervisor';

  // Permission helpers based on requirements
  // Sales Manager has same permissions as Executive Manager
  const canManageEmployees = isGeneralManager;
  const canManageProducts = isGeneralManager || isExecutiveManager || isSalesManager || isWarehouseSupervisor;
  const canManageOrders = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant || isWarehouseSupervisor;
  const canViewReports = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant;
  const canUpdatePaymentStatus = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant;
  const canUpdateOrderStatus = isGeneralManager || isExecutiveManager || isSalesManager || isWarehouseSupervisor;

  const value: AuthContextType = {
    user,
    session,
    role,
    loading,
    signIn,
    signUp,
    signOut,
    isGeneralManager,
    isExecutiveManager,
    isSalesManager,
    isSalesModerator,
    isAccountant,
    isWarehouseSupervisor,
    canManageEmployees,
    canManageProducts,
    canManageOrders,
    canViewReports,
    canUpdatePaymentStatus,
    canUpdateOrderStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
