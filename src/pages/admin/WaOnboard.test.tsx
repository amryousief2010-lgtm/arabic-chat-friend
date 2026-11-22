import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WaOnboard from "./WaOnboard";
import { FB_SDK_SRC, resetFacebookSdkForTests, type FacebookSdk } from "@/lib/waEmbeddedSignup";

const SECRET = "super-secret-auth-code";

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/admin/wa-onboard${search}`]}>
      <WaOnboard />
    </MemoryRouter>,
  );
}

describe("WaOnboard page", () => {
  beforeEach(() => {
    resetFacebookSdkForTests();
    vi.stubEnv("VITE_META_ES_CONFIG_ID", "");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    resetFacebookSdkForTests();
  });

  it("loads the Facebook SDK and stays closed without a config id", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "ربط رقم واتساب بيزنس (QR)" })).toBeDisabled();
    expect(document.querySelector(`script[src="${FB_SDK_SRC}"]`)).not.toBeNull();
    expect(screen.getByText("لا يوجد config_id")).toBeInTheDocument();
  });

  it("opens Embedded Signup with the coexistence options when config_id is given", async () => {
    const login = vi.fn<FacebookSdk["login"]>((callback) => {
      callback({ status: "connected", authResponse: { code: SECRET } });
    });
    renderPage("?config_id=1732339851839711");

    expect(document.querySelector(`script[src="${FB_SDK_SRC}"]`)).not.toBeNull();
    window.FB = { init: vi.fn(), login };
    await act(async () => {
      window.fbAsyncInit?.();
    });

    await screen.findByText("Facebook SDK جاهز");
    const button = screen.getByRole("button", { name: "ربط رقم واتساب بيزنس (QR)" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][1]).toEqual({
      config_id: "1732339851839711",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    });
    expect(screen.getByText("نجحت نافذة FB.login").parentElement).toHaveTextContent("نعم");
    expect(screen.getByText("رمز التفويض موجود").parentElement).toHaveTextContent("نعم");
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it("shows the session event, ids, and error from a facebook.com message", async () => {
    renderPage("?config_id=555555666666");
    window.FB = { init: vi.fn(), login: vi.fn() };
    await act(async () => {
      window.fbAsyncInit?.();
    });
    await screen.findByText("Facebook SDK جاهز");

    const payload = JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: {
        error_message: "verification failed",
        error_code: 133010,
        waba_id: "998877",
        phone_number_id: "112233",
        code: SECRET,
      },
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: payload,
        }),
      );
    });

    expect(screen.getAllByText("ERROR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("998877").length).toBeGreaterThan(0);
    expect(screen.getAllByText("112233").length).toBeGreaterThan(0);
    expect(screen.getByText("133010 — verification failed")).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://evilfacebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
            data: { waba_id: "should-not-appear" },
          }),
        }),
      );
    });
    expect(screen.queryByText("should-not-appear")).not.toBeInTheDocument();
  });
});
