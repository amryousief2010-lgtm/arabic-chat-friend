import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole =
  | 'general_manager'
  | 'executive_manager'
  | 'sales_manager'
  | 'sales_moderator'
  | 'accountant'
  | 'warehouse_supervisor'
  | 'farm_manager'
  | 'hatchery_manager'
  | 'brooding_manager'
  | 'slaughterhouse_manager'
  | 'meat_factory_manager'
  | 'feed_factory_manager'
  | 'hr_manager'
  | 'production_manager'
  | 'marketing_sales_manager'
  | 'financial_manager'
  | 'quality_manager';

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
  canManageStock: boolean;
  canManageOrders: boolean;
  canViewReports: boolean;
  canUpdatePaymentStatus: boolean;
  canUpdateOrderStatus: boolean;
  canUpdateOrderStatusForOrder: (orderCreatedBy: string | null) => boolean;
  // Module permissions
  canManageFeedFactory: boolean;
  canManageWarehouses: boolean;
  canManageFarm: boolean;
  canManageHatchery: boolean;
  canManageBrooding: boolean;
  canManageSlaughterhouse: boolean;
  canManageMeatFactory: boolean;
  canManageHr: boolean;
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
  const isFarmManager = role === 'farm_manager';
  const isHatcheryManager = role === 'hatchery_manager';
  const isBroodingManager = role === 'brooding_manager';
  const isSlaughterhouseManager = role === 'slaughterhouse_manager';
  const isMeatFactoryManager = role === 'meat_factory_manager';
  const isFeedFactoryManager = role === 'feed_factory_manager';
  const isHrManager = role === 'hr_manager';

  // Module-level write permissions
  const canManageFeedFactory = isGeneralManager || isExecutiveManager || isFeedFactoryManager;
  const canManageWarehouses = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const canManageFarm = isGeneralManager || isExecutiveManager || isFarmManager;
  const canManageHatchery = isGeneralManager || isExecutiveManager || isHatcheryManager;
  const canManageBrooding = isGeneralManager || isExecutiveManager || isBroodingManager;
  const canManageSlaughterhouse = isGeneralManager || isExecutiveManager || isSlaughterhouseManager;
  const canManageMeatFactory = isGeneralManager || isExecutiveManager || isMeatFactoryManager;
  const canManageHr = isGeneralManager || isExecutiveManager || isHrManager;

  // Permission helpers based on requirements
  // Sales Manager has same permissions as Executive Manager
  const canManageEmployees = isGeneralManager;
  const canManageProducts = isGeneralManager || isExecutiveManager || isSalesManager || isWarehouseSupervisor;
  const canManageStock = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const canManageOrders = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant || isWarehouseSupervisor;
  const canViewReports = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant || isWarehouseSupervisor;
  const canUpdatePaymentStatus = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant;
  const canUpdateOrderStatus = isGeneralManager || isExecutiveManager || isSalesManager || isWarehouseSupervisor;
  
  // Function to check if user can update order status for a specific order
  const canUpdateOrderStatusForOrder = (orderCreatedBy: string | null) => {
    // General Manager, Executive Manager, and Sales Manager can update any order
    if (isGeneralManager || isExecutiveManager || isSalesManager) {
      return true;
    }
    // Sales moderator can only update their own orders
    if (isSalesModerator && user && orderCreatedBy === user.id) {
      return true;
    }
    return false;
  };

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
    canManageStock,
    canManageOrders,
    canViewReports,
    canUpdatePaymentStatus,
    canUpdateOrderStatus,
    canUpdateOrderStatusForOrder,
    canManageFeedFactory,
    canManageWarehouses,
    canManageFarm,
    canManageHatchery,
    canManageBrooding,
    canManageSlaughterhouse,
    canManageMeatFactory,
    canManageHr,
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
