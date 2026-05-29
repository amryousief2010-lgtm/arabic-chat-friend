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
  | 'quality_manager'
  | 'shipping_company'
  | 'private_delivery_rep'
  | 'agouza_warehouse_keeper';

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  roles: AppRole[];
  profile: UserProfile | null;
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
  isShippingCompany: boolean;
  isPrivateDeliveryRep: boolean;
  isAgouzaWarehouseKeeper: boolean;
  // Permission helpers
  canManageEmployees: boolean;
  canManageProducts: boolean;
  canManageStock: boolean;
  canManageAgouzaStock: boolean;
  canCollectPrivateDelivery: boolean;
  canManageOrders: boolean;
  canViewReports: boolean;
  canUpdatePaymentStatus: boolean;
  canUpdateOrderStatus: boolean;
  canUpdateOrderStatusForOrder: (orderCreatedBy: string | null) => boolean;
  canDeleteOrders: boolean;
  canDeleteCustomers: boolean;
  canEditOrderItems: boolean;
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
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', userId)
        .maybeSingle();
      if (error) return null;
      return data as UserProfile | null;
    } catch {
      return null;
    }
  };

  const fetchUserRole = async (userId: string) => {
    try {
      // A user may have multiple roles (e.g. Ahmed Khater = agouza_warehouse_keeper + slaughterhouse_manager).
      // Fetch them all and pick the highest-priority one for the active session.
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching role:', error);
        return null;
      }

      const roles = (data || []).map((r: any) => r.role as AppRole);
      if (roles.length === 0) return null;

      const priority: AppRole[] = [
        'general_manager', 'executive_manager',
        'sales_manager', 'marketing_sales_manager', 'financial_manager',
        'production_manager', 'quality_manager', 'hr_manager',
        'farm_manager', 'hatchery_manager', 'brooding_manager',
        'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager',
        'warehouse_supervisor', 'agouza_warehouse_keeper',
        'accountant', 'sales_moderator', 'shipping_company', 'private_delivery_rep',
      ];
      for (const p of priority) {
        if (roles.includes(p)) return p;
      }
      return roles[0];
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
            fetchUserProfile(session.user.id).then(setProfile);
          }, 0);
        } else {
          setRole(null);
          setProfile(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        Promise.all([
          fetchUserRole(session.user.id).then(setRole),
          fetchUserProfile(session.user.id).then(setProfile),
        ]).finally(() => setLoading(false));
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
    setProfile(null);
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
  const isProductionManager = role === 'production_manager';
  const isMarketingSalesManager = role === 'marketing_sales_manager';
  const isFinancialManager = role === 'financial_manager';
  const isQualityManager = role === 'quality_manager';
  const isShippingCompany = role === 'shipping_company';
  const isPrivateDeliveryRep = role === 'private_delivery_rep';
  const isAgouzaWarehouseKeeper = role === 'agouza_warehouse_keeper';

  // Module-level write permissions
  const canManageFeedFactory = isGeneralManager || isExecutiveManager || isFeedFactoryManager || isProductionManager;
  const canManageWarehouses = isGeneralManager || isExecutiveManager || isWarehouseSupervisor || isProductionManager || isAgouzaWarehouseKeeper;
  const canManageFarm = isGeneralManager || isExecutiveManager || isFarmManager || isProductionManager;
  const canManageHatchery = isGeneralManager || isExecutiveManager || isHatcheryManager || isProductionManager;
  const canManageBrooding = isGeneralManager || isExecutiveManager || isBroodingManager || isProductionManager;
  const canManageSlaughterhouse = isGeneralManager || isExecutiveManager || isSlaughterhouseManager || isProductionManager || isAgouzaWarehouseKeeper;
  const canManageMeatFactory = isGeneralManager || isExecutiveManager || isMeatFactoryManager || isProductionManager;
  const canManageHr = isGeneralManager || isExecutiveManager || isHrManager;

  // Permission helpers based on requirements
  const canManageEmployees = isGeneralManager;
  const canManageProducts = isGeneralManager || isExecutiveManager || isSalesManager || isWarehouseSupervisor || isMarketingSalesManager;
  const canManageStock = isGeneralManager || isExecutiveManager || isWarehouseSupervisor || isProductionManager;
  const canManageAgouzaStock = isGeneralManager || isExecutiveManager || isWarehouseSupervisor || isAgouzaWarehouseKeeper;
  const canCollectPrivateDelivery = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const canManageOrders = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant || isWarehouseSupervisor || isMarketingSalesManager || isFinancialManager;
  const canViewReports = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant || isWarehouseSupervisor || isMarketingSalesManager || isFinancialManager || isQualityManager || isProductionManager;
  const canUpdatePaymentStatus = isGeneralManager || isExecutiveManager || isSalesManager || isAccountant || isMarketingSalesManager || isFinancialManager || isWarehouseSupervisor;
  const canUpdateOrderStatus = isGeneralManager || isExecutiveManager || isSalesManager || isWarehouseSupervisor || isMarketingSalesManager || isShippingCompany || isPrivateDeliveryRep;
  const canDeleteOrders = isGeneralManager || isExecutiveManager || isSalesManager || isMarketingSalesManager;
  const canDeleteCustomers = isGeneralManager || isExecutiveManager || isMarketingSalesManager;
  const canEditOrderItems = isGeneralManager || isExecutiveManager || isSalesManager || isMarketingSalesManager || isSalesModerator;
  
  const canUpdateOrderStatusForOrder = (_orderCreatedBy: string | null) => {
    return (
      isGeneralManager ||
      isExecutiveManager ||
      isSalesManager ||
      isMarketingSalesManager ||
      isShippingCompany ||
      isWarehouseSupervisor ||
      isPrivateDeliveryRep
    );
  };

  const value: AuthContextType = {
    user,
    session,
    role,
    profile,
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
    isShippingCompany,
    isPrivateDeliveryRep,
    isAgouzaWarehouseKeeper,
    canManageEmployees,
    canManageProducts,
    canManageStock,
    canManageAgouzaStock,
    canCollectPrivateDelivery,
    canManageOrders,
    canViewReports,
    canUpdatePaymentStatus,
    canUpdateOrderStatus,
    canUpdateOrderStatusForOrder,
    canDeleteOrders,
    canDeleteCustomers,
    canEditOrderItems,
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
