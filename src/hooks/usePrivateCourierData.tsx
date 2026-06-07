import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CourierStatus, CollectionStatus } from "@/lib/privateCourier/constants";

export interface EligibleOrder {
  id: string;
  order_number: string;
  status: string;
  total: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  delivery_address: string | null;
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_governorate: string | null;
  assigned_route_id: string | null;
  tracking_status: CourierStatus | null;
  tracking_courier_id: string | null;
}

export interface MyAssignedOrder {
  id: string;
  order_number: string;
  status: string;
  total: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  delivery_address: string | null;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_governorate: string | null;
  route_name: string | null;
  tracking_status: CourierStatus | null;
  collection_status: CollectionStatus | null;
  amount_collected: number | null;
}

export interface PCRoute {
  id: string;
  name: string;
  region: string | null;
  governorates: string[];
  cities: string[];
  assigned_courier_id: string | null;
  planned_date: string | null;
  start_time: string | null;
  expected_end_time: string | null;
  status: string;
  color: string | null;
  notes: string | null;
  created_at: string;
}

export function useEligibleOrders() {
  const [data, setData] = useState<EligibleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase.rpc("pc_list_eligible_orders" as any);
    if (err) setError(err.message);
    setData((rows as any) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}

export function useMyAssignedOrders() {
  const [data, setData] = useState<MyAssignedOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await supabase.rpc("pc_get_my_assigned_orders" as any);
    setData((rows as any) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, refetch };
}

export function usePCRoutes() {
  const [data, setData] = useState<PCRoute[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await (supabase as any)
      .from("pc_routes")
      .select("*")
      .neq("status", "archived")
      .order("created_at", { ascending: false });

    setData((rows as any) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, refetch };
}
