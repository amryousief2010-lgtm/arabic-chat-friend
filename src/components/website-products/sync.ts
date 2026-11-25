import { supabase } from "@/integrations/supabase/client";

export const FN = "woo-catalog-sync";

/** يستدعي دالة المزامنة ويعيد رمز الخطأ من جسم الاستجابة إن وُجد. */
export async function callSync<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (!error) return { data: data as T, error: null };
  let code = error.message;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = await (error as any).context?.json?.();
    if (j?.error) code = j.error;
  } catch {
    /* ignore */
  }
  return { data: null, error: code };
}

export interface SitePreview {
  changes: { field: string; before: string | null; after: string }[];
  warnings: string[];
  token: string;
  keys_configured: boolean;
}

export type SiteEditBody =
  | { kind: "price"; regular_price: number }
  | { kind: "sale"; sale_price: number | null; date_from?: string | null; date_to?: string | null }
  | { kind: "visibility"; status: "publish" | "draft"; catalog_visibility: "visible" | "hidden" }
  | { kind: "sku" }
  | { kind: "image" };

export const sitePreview = (wooId: number, edit: SiteEditBody) => callSync<SitePreview>({ action: "site_preview", woo_product_id: wooId, edit });
export const siteApply = (wooId: number, edit: SiteEditBody, token: string) =>
  callSync<{ changed: boolean }>({ action: "site_apply", woo_product_id: wooId, edit, token });

export const restorePreview = (backupId: string) =>
  callSync<{
    changes: { field: string; before: unknown; after: unknown }[];
    warnings: string[];
    token: string;
    keys_configured: boolean;
    confirmed_by: string | null;
    confirmed_at: string;
    woo_product_id: number;
  }>({ action: "restore_preview", backup_id: backupId });

export const restoreApply = (backupId: string, token: string) =>
  callSync<{ changed: boolean }>({ action: "restore_apply", backup_id: backupId, token });

export const siteApplyWithReason = (wooId: number, edit: SiteEditBody, token: string, reason?: string) =>
  callSync<{ changed: boolean }>({ action: "site_apply", woo_product_id: wooId, edit, token, reason });
