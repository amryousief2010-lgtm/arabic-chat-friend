import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FB_SDK_SRC,
  GRAPH_API_VERSION,
  META_APP_ID,
  buildEmbeddedSignupLoginOptions,
  initFacebookSdk,
  isFacebookMessageOrigin,
  loadFacebookSdk,
  loginResultFromResponse,
  parseEmbeddedSignupMessage,
  resetFacebookSdkForTests,
  resolveEmbeddedSignupConfigId,
} from "../waEmbeddedSignup";

describe("resolveEmbeddedSignupConfigId", () => {
  it("prefers a numeric query config_id over the env value", () => {
    const resolved = resolveEmbeddedSignupConfigId("111111", "?config_id=222222");
    expect(resolved).toEqual({ configId: "222222", source: "query", invalidQuery: false });
  });

  it("uses the env value when the query param is absent", () => {
    expect(resolveEmbeddedSignupConfigId("333333", "")).toEqual({
      configId: "333333",
      source: "env",
      invalidQuery: false,
    });
  });

  it("rejects a non-numeric query id and does not fall through to a bad env value", () => {
    expect(resolveEmbeddedSignupConfigId("not-an-id", "?config_id=abc")).toEqual({
      configId: null,
      source: null,
      invalidQuery: true,
    });
  });

  it("ignores an invalid query id when the env value is valid", () => {
    expect(resolveEmbeddedSignupConfigId("444444", "config_id=nope")).toEqual({
      configId: "444444",
      source: "env",
      invalidQuery: true,
    });
  });
});

describe("buildEmbeddedSignupLoginOptions", () => {
  it("launches coexistence with a code response", () => {
    expect(buildEmbeddedSignupLoginOptions("555555")).toEqual({
      config_id: "555555",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    });
  });
});

describe("loginResultFromResponse", () => {
  it("reports success and code presence without returning the code", () => {
    const result = loginResultFromResponse({
      status: "connected",
      authResponse: { code: "secret-auth-code" },
    });
    expect(result).toEqual({ succeeded: true, codePresent: true, status: "connected" });
    expect(JSON.stringify(result)).not.toContain("secret-auth-code");
  });

  it("reports a cancelled login", () => {
    expect(loginResultFromResponse({ status: "unknown", authResponse: null })).toEqual({
      succeeded: false,
      codePresent: false,
      status: "unknown",
    });
  });
});

describe("embedded signup session messages", () => {
  it("accepts facebook.com origins only", () => {
    expect(isFacebookMessageOrigin("https://www.facebook.com")).toBe(true);
    expect(isFacebookMessageOrigin("https://web.facebook.com")).toBe(true);
    expect(isFacebookMessageOrigin("https://business.facebook.com")).toBe(true);
    expect(isFacebookMessageOrigin("http://www.facebook.com")).toBe(false);
    expect(isFacebookMessageOrigin("https://evilfacebook.com")).toBe(false);
    expect(isFacebookMessageOrigin("https://facebook.com.evil.example")).toBe(false);
  });

  it("parses a coexistence finish event from a JSON string", () => {
    expect(
      parseEmbeddedSignupMessage(
        JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "111", phone_number_id: "222", code: "must-not-leak" },
        }),
      ),
    ).toEqual({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      wabaId: "111",
      phoneNumberId: "222",
      errorMessage: null,
      errorCode: null,
      currentStep: null,
      sessionId: null,
    });
  });

  it("parses an error object payload", () => {
    expect(
      parseEmbeddedSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "ERROR",
        data: {
          error_message: "name rejected",
          error_code: 524126,
          session_id: "sess-1",
        },
      }),
    ).toMatchObject({
      event: "ERROR",
      errorMessage: "name rejected",
      errorCode: "524126",
      sessionId: "sess-1",
    });
  });

  it("ignores unrelated messages", () => {
    expect(parseEmbeddedSignupMessage("not-json")).toBeNull();
    expect(parseEmbeddedSignupMessage({ type: "OTHER" })).toBeNull();
  });
});

describe("loadFacebookSdk", () => {
  beforeEach(() => {
    resetFacebookSdkForTests();
  });

  it("inserts the SDK script and initializes it once fbAsyncInit runs", async () => {
    const init = vi.fn();
    const pending = loadFacebookSdk();
    const script = document.querySelector(`script[src="${FB_SDK_SRC}"]`);
    expect(script).not.toBeNull();
    expect(script).toHaveAttribute("crossorigin", "anonymous");

    window.FB = { init, login: vi.fn() };
    window.fbAsyncInit?.();
    await pending;

    expect(init).toHaveBeenCalledWith({
      appId: META_APP_ID,
      autoLogAppEvents: true,
      xfbml: true,
      version: GRAPH_API_VERSION,
    });

    initFacebookSdk();
    expect(init).toHaveBeenCalledTimes(1);
  });
});
