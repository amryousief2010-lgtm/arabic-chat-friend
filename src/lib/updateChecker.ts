// 🔄 وحدة فحص التحديثات المركزية
// - تقرأ التكرار من VITE_UPDATE_CHECK_INTERVAL_MS (افتراضي 60 ثانية)
// - تسجّل سبب كل إعادة تحميل في console + localStorage (للوحة المسؤول)

declare const __APP_VERSION__: string;

export const CURRENT_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const ENV_INTERVAL = Number(import.meta.env.VITE_UPDATE_CHECK_INTERVAL_MS);
export const CHECK_INTERVAL_MS =
  Number.isFinite(ENV_INTERVAL) && ENV_INTERVAL >= 5000 ? ENV_INTERVAL : 60_000;

export const CHECK_ON_FOCUS =
  String(import.meta.env.VITE_UPDATE_CHECK_ON_FOCUS ?? "true").toLowerCase() !==
  "false";

const RELOAD_GUARD_KEY = "auto-update-reloading";
const LOG_KEY = "update-reload-log";
const LOG_MAX = 20;

export type ReloadReason =
  | "boot"
  | "interval"
  | "focus"
  | "visibility"
  | "post-login"
  | "manual";

export interface ReloadLogEntry {
  at: string; // ISO timestamp
  reason: ReloadReason;
  oldVersion: string;
  newVersion: string;
}

export const getReloadLog = (): ReloadLogEntry[] => {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as ReloadLogEntry[]) : [];
  } catch {
    return [];
  }
};

const pushLog = (entry: ReloadLogEntry) => {
  try {
    const list = getReloadLog();
    list.unshift(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, LOG_MAX)));
  } catch {
    // ignore
  }
};

export const clearReloadLog = () => {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore
  }
};

const clearAllCachesAndSW = async () => {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }
};

export interface VersionFetchResult {
  remote: string | null;
  upToDate: boolean;
  error?: string;
}

export const fetchRemoteVersion = async (
  timeoutMs = 2500,
): Promise<VersionFetchResult> => {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { remote: null, upToDate: true, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { version?: string };
    const remote = data?.version ?? null;
    return { remote, upToDate: !remote || remote === CURRENT_VERSION };
  } catch (e) {
    return { remote: null, upToDate: true, error: (e as Error)?.message ?? "fetch failed" };
  }
};

let reloading = false;

export const triggerReload = async (
  reason: ReloadReason,
  remoteVersion: string,
) => {
  if (reloading) return;
  reloading = true;

  const entry: ReloadLogEntry = {
    at: new Date().toISOString(),
    reason,
    oldVersion: CURRENT_VERSION,
    newVersion: remoteVersion,
  };
  pushLog(entry);
  console.info(
    `[update] reload (${reason}): ${entry.oldVersion} → ${entry.newVersion} @ ${entry.at}`,
  );

  await clearAllCachesAndSW();
  sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  window.location.reload();
};

/** آخر نتيجة فحص — لعرضها في واجهة الـ badge */
export interface LastCheckState {
  at: string;
  remote: string | null;
  upToDate: boolean;
  error?: string;
}
let lastCheck: LastCheckState | null = null;
const listeners = new Set<(s: LastCheckState) => void>();
export const getLastCheck = () => lastCheck;
export const subscribeToChecks = (fn: (s: LastCheckState) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** فحص + إعادة تحميل إن لزم. يُرجع true لو سيُعاد التحميل. */
export const checkAndReloadIfStale = async (
  reason: ReloadReason,
): Promise<boolean> => {
  // حماية من حلقة إعادة التحميل عند الإقلاع فقط
  if (reason === "boot" && sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    return false;
  }
  const result = await fetchRemoteVersion();
  lastCheck = {
    at: new Date().toISOString(),
    remote: result.remote,
    upToDate: result.upToDate,
    error: result.error,
  };
  listeners.forEach((fn) => fn(lastCheck!));
  console.info(
    `[update] check (${reason}): current=${CURRENT_VERSION} remote=${result.remote ?? "?"} upToDate=${result.upToDate}`,
  );
  if (result.upToDate || !result.remote) return false;
  await triggerReload(reason, result.remote);
  return true;
};

