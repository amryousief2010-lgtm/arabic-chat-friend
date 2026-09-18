import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks --------------------------------------------------------------

// Heavy chrome we don't need in this integration test.
vi.mock("@/components/layout/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/layout/Header", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { fakeNotifications, updateEq, deleteEq, authState } = vi.hoisted(() => {
  const fakeNotifications = [
    {
      id: "n1",
      title: "ملاحظة من آية",
      description: "العميل لم يرد على الهاتف — برجاء المحاولة مساءً",
      type: "manual_note",
      is_read: false,
      order_id: "order-AAA",
      created_at: "2026-05-15T10:00:00Z",
    },
    {
      id: "n2",
      title: "تنبيه: مخزون منخفض",
      description: "صنف لحم مفروم وصل لحده الأدنى",
      type: "low_stock",
      is_read: false,
      order_id: null,
      created_at: "2026-05-14T09:00:00Z",
    },
    {
      id: "n3",
      title: "ملاحظة من نورا",
      description: "غيّر عنوان التوصيل إلى شارع 9 بدل شارع 7",
      type: "manual_note",
      is_read: false,
      order_id: "order-BBB",
      created_at: "2026-05-13T08:00:00Z",
    },
    {
      id: "n4",
      title: "تنبيه: مطلوب تصنيع",
      description: "الكمية المطلوبة أكبر من المخزون",
      type: "production_needed",
      is_read: false,
      order_id: "order-CCC",
      created_at: "2026-05-12T07:00:00Z",
    },
  ];
  const updateEq = vi.fn((col: string, value: string) => {
    // Reflect the update server-side so refetches don't undo the optimistic
    // flip in the UI.
    if (col === "id") {
      const n = fakeNotifications.find((x) => x.id === value);
      if (n) n.is_read = true;
    }
    return Promise.resolve({ error: null });
  });
  const deleteEq = vi.fn(() => Promise.resolve({ error: null }));
  const authState = {
    user: { id: "u1" },
    isSalesManager: false,
    isGeneralManager: false,
    isExecutiveManager: false,
  };
  return { fakeNotifications, updateEq, deleteEq, authState };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (_table: string) => ({
        select: () => ({
          order: () => Promise.resolve({ data: fakeNotifications, error: null }),
        }),
        update: () => {
          const filters: Record<string, unknown> = {};
          const chain: {
            eq: (col: string, value: unknown) => typeof chain;
            then: (onFulfilled?: unknown, onRejected?: unknown) => Promise<{ error: null }>;
          } = {
            eq: (col: string, value: unknown) => {
              filters[col] = value;
              updateEq(col, String(value));
              return chain;
            },
            then: (onFulfilled?: unknown, onRejected?: unknown) => {
              const keys = Object.keys(filters);
              if (keys.length > 1 || (keys.length === 1 && keys[0] !== "id")) {
                for (const n of fakeNotifications) {
                  if (keys.every((k) => (n as any)[k] === filters[k])) {
                    n.is_read = true;
                  }
                }
              }
              return Promise.resolve({ error: null }).then(
                onFulfilled as any,
                onRejected as any,
              );
            },
          };
          return chain;
        },
        delete: () => ({ eq: deleteEq }),
      }),
    },
  };
});

import Notifications from "@/pages/Notifications";

const OrderDetailsStub = () => {
  const { id } = useParams();
  // Show ONLY the description of the notification whose order_id matches :id.
  const matching = fakeNotifications.filter((n) => n.order_id === id);
  return (
    <div>
      <p data-testid="order-id">{id}</p>
      {matching.map((n) => (
        <p key={n.id} data-testid="order-note">{n.description}</p>
      ))}
    </div>
  );
};

const renderApp = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/notifications"]}>
        <Routes>
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/orders/:id" element={<OrderDetailsStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Notifications → /orders/:id integration", () => {
  beforeEach(() => {
    updateEq.mockClear();
    deleteEq.mockClear();
    authState.isGeneralManager = false;
    authState.isSalesManager = false;
    authState.isExecutiveManager = false;
    // Reset is_read state between tests.
    fakeNotifications.forEach((n) => (n.is_read = false));
  });

  it("clicking an urgent notification confirms then navigates to /orders/:id with the matching note shown ONLY for that order", async () => {
    renderApp();

    // Wait for the urgent notification to render.
    const item = await screen.findByText("ملاحظة من آية");
    fireEvent.click(item);

    // A confirmation dialog appears first for urgent unread notifications.
    const confirmBtn = await screen.findByRole("button", { name: "نعم، انتقل" });
    fireEvent.click(confirmBtn);

    // Navigated to the right order detail.
    await waitFor(() => {
      expect(screen.getByTestId("order-id")).toHaveTextContent("order-AAA");
    });

    // The note shown corresponds to that order only — not the other notification's note.
    const notes = screen.getAllByTestId("order-note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent("العميل لم يرد على الهاتف — برجاء المحاولة مساءً");
    expect(screen.queryByText(/شارع 9 بدل شارع 7/)).not.toBeInTheDocument();

    // The click should also have marked the notification as read.
    expect(updateEq).toHaveBeenCalledWith("id", "n1");
  });

  it("urgent-only filter hides informational notifications (low_stock) and sorts by newest", async () => {
    renderApp();

    await screen.findByText("ملاحظة من آية");
    expect(screen.getByText(/مخزون منخفض/)).toBeInTheDocument();
    expect(screen.getByText("ملاحظة من نورا")).toBeInTheDocument();
    expect(screen.getByText(/مطلوب تصنيع/)).toBeInTheDocument();

    // Flip the urgent-only switch.
    fireEvent.click(screen.getByLabelText("يتطلب رد فقط"));

    await waitFor(() => {
      expect(screen.queryByText(/مخزون منخفض/)).not.toBeInTheDocument();
      expect(screen.queryByText(/مطلوب تصنيع/)).not.toBeInTheDocument();
    });

    const items = screen.getAllByTestId("notification-item");
    // Two urgent notifications, newest first (n1 then n3).
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("ملاحظة من آية");
    expect(items[1]).toHaveTextContent("ملاحظة من نورا");
    expect(items[0].getAttribute("data-urgent")).toBe("true");
  });

  it("inline mark-as-read button flips the badge optimistically without a reload", async () => {
    renderApp();

    const initialItem = (await screen.findByText("ملاحظة من آية")).closest(
      '[data-testid="notification-item"]',
    ) as HTMLElement;
    expect(initialItem).toBeTruthy();
    expect(initialItem.textContent).toMatch(/يتطلب رد فوري/);

    const btn = initialItem.querySelector('button[title="تحديد كمقروء"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);

    // Re-query after re-render — the badge should be gone.
    await waitFor(() => {
      const refreshed = screen.getByText("ملاحظة من آية").closest(
        '[data-testid="notification-item"]',
      ) as HTMLElement;
      expect(refreshed.getAttribute("data-urgent")).toBe("false");
      expect(refreshed.textContent).not.toMatch(/يتطلب رد فوري/);
    });
    expect(updateEq).toHaveBeenCalledWith("id", "n1");
  });

  it("hides the manufacturing mark-read action unless the user is GM", async () => {
    renderApp();
    await screen.findByText("تنبيه: مطلوب تصنيع");
    expect(screen.queryByTestId("mark-production-needed-read")).not.toBeInTheDocument();
  });

  it("GM can mark unread production_needed alerts read without deleting anything", async () => {
    authState.isGeneralManager = true;
    renderApp();

    const btn = await screen.findByTestId("mark-production-needed-read");
    expect(btn).toHaveTextContent("تعليم كل إشعارات التصنيع كمقروءة");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fakeNotifications.find((n) => n.id === "n4")?.is_read).toBe(true);
    });
    expect(fakeNotifications.find((n) => n.id === "n1")?.is_read).toBe(false);
    expect(fakeNotifications.find((n) => n.id === "n2")?.is_read).toBe(false);
    expect(fakeNotifications.find((n) => n.id === "n3")?.is_read).toBe(false);
    expect(updateEq).toHaveBeenCalledWith("type", "production_needed");
    expect(updateEq).toHaveBeenCalledWith("is_read", "false");
    expect(deleteEq).not.toHaveBeenCalled();
  });
});
