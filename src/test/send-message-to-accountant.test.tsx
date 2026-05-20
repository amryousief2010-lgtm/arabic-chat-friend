import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Heavy chrome stubs -------------------------------------------------
vi.mock("@/components/layout/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/layout/Header", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// --- Auth: sender is the general_manager --------------------------------
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ role: "general_manager", user: { id: "gm-1" } }),
}));

const ACCOUNTANT_ID = "acc-shaala-1";

// --- In-memory backend --------------------------------------------------
const notificationsStore: any[] = [];
const profiles = [
  { id: ACCOUNTANT_ID, full_name: "محمد شعلة", email: "mohamed.shaala@coceg.net" },
  { id: "u2", full_name: "موظف آخر", email: "other@coceg.net" },
];
const userRoles = [
  { user_id: ACCOUNTANT_ID, role: "accountant" },
  { user_id: "u2", role: "moderator" },
];

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: profiles, error: null }),
        }),
      } as any;
    }
    if (table === "user_roles") {
      return {
        select: () => Promise.resolve({ data: userRoles, error: null }),
      } as any;
    }
    if (table === "notifications") {
      return {
        select: () => ({
          order: () =>
            Promise.resolve({
              data: [...notificationsStore].sort(
                (a, b) =>
                  new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
              ),
              error: null,
            }),
        }),
        insert: (row: any) => {
          notificationsStore.push({
            id: `gen-${notificationsStore.length + 1}`,
            is_read: false,
            order_id: null,
            created_at: new Date().toISOString(),
            ...row,
          });
          return Promise.resolve({ error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      } as any;
    }
    return { select: () => Promise.resolve({ data: [], error: null }) } as any;
  };
  return { supabase: { from } };
});

import SendMessage from "@/pages/SendMessage";
import Notifications from "@/pages/Notifications";

const renderApp = (initial: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/send-message" element={<SendMessage />} />
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Sending the accountant welcome message", () => {
  beforeEach(() => {
    notificationsStore.length = 0;
  });

  it("inserts a targeted notification and shows it on the Notifications page immediately", async () => {
    // 1) Send the welcome message from the SendMessage page.
    const { unmount } = renderApp("/send-message");

    // Pick the accountant from the recipient dropdown.
    const recipientTrigger = await screen.findByText("اختر الموظف");
    fireEvent.click(recipientTrigger);
    const accountantOption = await screen.findByText(/محمد شعلة/);
    fireEvent.click(accountantOption);

    // Pick the welcome template — fills title + body automatically.
    const templateTrigger = screen
      .getAllByRole("combobox")
      .find((el) => within(el).queryByText("رسالة مخصصة")) as HTMLElement;
    fireEvent.click(templateTrigger);
    fireEvent.click(await screen.findByText("ترحيب بالمحاسب وشرح المهام"));

    // Send.
    fireEvent.click(screen.getByRole("button", { name: /إرسال الرسالة/ }));

    await waitFor(() => {
      expect(notificationsStore).toHaveLength(1);
    });

    const inserted = notificationsStore[0];
    expect(inserted.target_user_id).toBe(ACCOUNTANT_ID);
    expect(inserted.type).toBe("direct_message");
    expect(inserted.title).toMatch(/محاسب عام/);
    expect(inserted.description).toMatch(/تأكيد التحصيل/);
    expect(inserted.is_read).toBe(false);

    unmount();

    // 2) The Notifications page reflects the new message right away.
    renderApp("/notifications");
    expect(await screen.findByText("مرحباً بك كمحاسب عام على التطبيق")).toBeInTheDocument();
    expect(screen.getByText(/تأكيد التحصيل/)).toBeInTheDocument();
  });
});
