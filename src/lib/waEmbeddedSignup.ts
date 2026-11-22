/**
 * Client-side WhatsApp Embedded Signup (coexistence) helpers.
 *
 * Launch options follow Meta's current "Onboard WhatsApp Business app users"
 * sample. A request with no extras.version is served as Embedded Signup v4,
 * where featureType is what replaces the new-account screen with the WhatsApp
 * Business app QR. sessionInfoVersion is still in that sample; v4 already
 * returns session info without it, and v5 ignores the field.
 *
 * The exchangeable code from FB.login is never returned or stored here.
 * Completing the popup migrates the number. Exchanging the code needs the
 * app secret and is only for minting a new business token.
 */

export const META_APP_ID = "1732339851839711";

/** Latest Graph version named by Meta's Embedded Signup implementation page. */
export const GRAPH_API_VERSION = "v27.0";

export const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

export const EMBEDDED_SIGNUP_CONFIG_ENV = "VITE_META_ES_CONFIG_ID";

const CONFIG_ID_PATTERN = /^\d{6,32}$/;
const SDK_INIT_FLAG = "__cocegFbSdkInitialized";

export interface FacebookAuthResponse {
  code?: string;
  accessToken?: string;
  userID?: string;
  expiresIn?: number;
  signedRequest?: string;
}

export interface FacebookLoginResponse {
  status?: string;
  authResponse?: FacebookAuthResponse | null;
}

export interface EmbeddedSignupLoginOptions {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: {
    setup: Record<string, never>;
    featureType: "whatsapp_business_app_onboarding";
    sessionInfoVersion: "3";
  };
}

export interface FacebookSdk {
  init: (params: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: EmbeddedSignupLoginOptions,
  ) => void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
    [SDK_INIT_FLAG]?: boolean;
  }
}

export interface ResolvedConfigId {
  configId: string | null;
  source: "query" | "env" | null;
  invalidQuery: boolean;
}

export function resolveEmbeddedSignupConfigId(
  envValue: string | undefined | null,
  search: string | URLSearchParams,
): ResolvedConfigId {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const query = params.get("config_id")?.trim() ?? "";
  if (CONFIG_ID_PATTERN.test(query)) {
    return { configId: query, source: "query", invalidQuery: false };
  }
  const env = (envValue ?? "").trim();
  if (CONFIG_ID_PATTERN.test(env)) {
    return { configId: env, source: "env", invalidQuery: query.length > 0 };
  }
  return { configId: null, source: null, invalidQuery: query.length > 0 };
}

export function buildEmbeddedSignupLoginOptions(configId: string): EmbeddedSignupLoginOptions {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      setup: {},
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3",
    },
  };
}

export interface EmbeddedSignupLoginResult {
  succeeded: boolean;
  codePresent: boolean;
  status: string | null;
}

export function loginResultFromResponse(
  response: FacebookLoginResponse | null | undefined,
): EmbeddedSignupLoginResult {
  const code = response?.authResponse?.code;
  return {
    succeeded: Boolean(response?.authResponse),
    codePresent: typeof code === "string" && code.length > 0,
    status: typeof response?.status === "string" ? response.status : null,
  };
}

export interface EmbeddedSignupSession {
  type: "WA_EMBEDDED_SIGNUP";
  event: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  currentStep: string | null;
  sessionId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function parseEmbeddedSignupMessage(raw: unknown): EmbeddedSignupSession | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  const record = asRecord(value);
  if (!record || record.type !== "WA_EMBEDDED_SIGNUP") return null;
  const data = asRecord(record.data) ?? {};
  return {
    type: "WA_EMBEDDED_SIGNUP",
    event: stringOrNull(record.event) ?? "UNKNOWN",
    wabaId: stringOrNull(data.waba_id),
    phoneNumberId: stringOrNull(data.phone_number_id),
    errorMessage: stringOrNull(data.error_message),
    errorCode: data.error_code == null || data.error_code === "" ? null : String(data.error_code),
    currentStep: stringOrNull(data.current_step),
    sessionId: stringOrNull(data.session_id),
  };
}

export function isFacebookMessageOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

export function initFacebookSdk(): void {
  if (!window.FB || window[SDK_INIT_FLAG]) return;
  window.FB.init({
    appId: META_APP_ID,
    autoLogAppEvents: true,
    xfbml: true,
    version: GRAPH_API_VERSION,
  });
  window[SDK_INIT_FLAG] = true;
}

let sdkPromise: Promise<void> | null = null;

export function loadFacebookSdk(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Facebook SDK requires a browser"));
  }
  if (window.FB) {
    initFacebookSdk();
    return Promise.resolve();
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const previous = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      if (previous && previous !== window.fbAsyncInit) {
        try {
          previous();
        } catch {
          // A previous initializer must not block Embedded Signup.
        }
      }
      try {
        initFacebookSdk();
        resolve();
      } catch (error) {
        sdkPromise = null;
        reject(error instanceof Error ? error : new Error("Facebook SDK init failed"));
      }
    };

    if (!document.querySelector(`script[src="${FB_SDK_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = FB_SDK_SRC;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => {
        sdkPromise = null;
        reject(new Error("تعذر تحميل Facebook SDK"));
      };
      document.body.appendChild(script);
    }
  });

  return sdkPromise;
}

export function resetFacebookSdkForTests(): void {
  sdkPromise = null;
  delete window.FB;
  delete window.fbAsyncInit;
  delete window[SDK_INIT_FLAG];
  document.querySelectorAll(`script[src="${FB_SDK_SRC}"]`).forEach((node) => node.remove());
}
