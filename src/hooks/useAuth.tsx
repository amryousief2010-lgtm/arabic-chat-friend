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
  | 'agouza_warehouse_keeper'
  | 'brooding_dashboard_viewer'
  | 'lab_treasury_keeper'
  | 'lab_external_collector'
  | 'lab_treasury_approver'
  | 'slaughterhouse_custody_keeper';

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
  isFarmManager: boolean;
  isHatcheryManager: boolean;
  isProductionManager: boolean;
  isQualityManager: boolean;
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

  const fetchUserRoles = async (userId: string): Promise<{ primary: AppRole | null; all: AppRole[] }> => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching role:', error);
        return { primary: null, all: [] };
      }

      const all = (data || []).map((r: any) => r.role as AppRole);
      if (all.length === 0) return { primary: null, all: [] };

      const priority: AppRole[] = [
        'general_manager', 'executive_manager',
        'sales_manager', 'marketing_sales_manager', 'financial_manager',
        'production_manager', 'quality_manager', 'hr_manager',
        'farm_manager', 'hatchery_manager', 'brooding_manager',
        'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager',
        'warehouse_supervisor', 'agouza_warehouse_keeper',
        'accountant', 'sales_moderator', 'shipping_company', 'private_delivery_rep',
      ];
      const primary = priority.find((p) => all.includes(p)) ?? all[0];
      return { primary, all };
    } catch (error) {
      console.error('Error fetching role:', error);
      return { primary: null, all: [] };
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // Skip INITIAL_SESSION — handled by getSession() below to avoid duplicate
        // role/profile fetches (4 extra round-trips on every page load).
        if (event === 'INITIAL_SESSION') return;

        // Defer role fetch with setTimeout to prevent deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchUserRoles(session.user.id).then(({ primary, all }) => {
              setRole(primary);
              setRoles(all);
            });
            fetchUserProfile(session.user.id).then(setProfile);
          }, 0);
        } else {
          setRole(null);
          setRoles([]);
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
          fetchUserRoles(session.user.id).then(({ primary, all }) => {
            setRole(primary);
            setRoles(all);
          }),
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

  // Role checks — consider ALL of the user's roles, not only the primary one.
  const has = (r: AppRole) => roles.includes(r);
  const isGeneralManager = has('general_manager');
  const isExecutiveManager = has('executive_manager');
  const isSalesManager = has('sales_manager');
  const isSalesModerator = has('sales_moderator');
  const isAccountant = has('accountant');
  const isWarehouseSupervisor = has('warehouse_supervisor');
  const isFarmManager = has('farm_manager');
  const isHatcheryManager = has('hatchery_manager');
  const isBroodingManager = has('brooding_manager');
  const isSlaughterhouseManager = has('slaughterhouse_manager');
  const isMeatFactoryManager = has('meat_factory_manager');
  const isFeedFactoryManager = has('feed_factory_manager');
  const isHrManager = has('hr_manager');
  const isProductionManager = has('production_manager');
  const isMarketingSalesManager = has('marketing_sales_manager');
  const isFinancialManager = has('financial_manager');
  const isQualityManager = has('quality_manager');
  const isShippingCompany = has('shipping_company');
  const isPrivateDeliveryRep = has('private_delivery_rep');
  const isAgouzaWarehouseKeeper = has('agouza_warehouse_keeper');

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
    roles,
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
    isFarmManager,
    isHatcheryManager,
    isProductionManager,
    isQualityManager,
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
