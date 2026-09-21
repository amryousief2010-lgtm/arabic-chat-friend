/** Shared-secret header used by pg_cron → sync-zodex-shipments. */
export const ZODEX_CRON_SECRET_HEADER = "x-zodex-cron-secret";

/** Lovable Cloud / Edge env name. Must match vault secret `zodex_cron_secret`. */
export const ZODEX_CRON_SECRET_ENV = "ZODEX_CRON_SECRET";

/**
 * Constant-time string compare.
 * SHA-256 both sides first so a length mismatch cannot short-circuit.
 * Never log `a` or `b`.
 */
export async function timingSafeEqualText(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= x[i] ^ y[i];
  }
  return diff === 0;
}

/**
 * True only when both sides are non-empty and match (constant-time).
 * Empty / missing values never authenticate.
 */
export async function matchesCronSecret(provided: string, expected: string): Promise<boolean> {
  const got = (provided ?? "").trim();
  const want = (expected ?? "").trim();
  if (!got || !want) return false;
  return timingSafeEqualText(got, want);
}

export function readCronSecretHeader(headers: { get(name: string): string | null }): string {
  return (headers.get(ZODEX_CRON_SECRET_HEADER) || "").trim();
}
