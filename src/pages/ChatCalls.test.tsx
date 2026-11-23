import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let roles: string[] = ["general_manager"];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ roles }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div dir="rtl">{children}</div>,
}));
vi.mock("@/components/layout/Header", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/chatManagement/HotlineUsernamesCard", () => ({ HotlineUsernamesCard: () => null }));
vi.mock("@/components/chatManagement/CsvImportCard", () => ({ CsvImportCard: () => null }));
vi.mock("@/components/chatManagement/RecordingUploadCard", () => ({
  RecordingUploadCard: () => null,
  uploadRecording: vi.fn(),
}));
vi.mock("@/components/chatManagement/CallAnalysisDialog", () => ({ CallAnalysisDialog: () => null }));

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => from(table),
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
    functions: { invoke: vi.fn() },
  },
}));

import ChatCalls from "@/pages/ChatCalls";

type Row = { data: unknown; error: { code?: string; message?: string } | null };
const MASKED = "010•••321";
const callRow = {
  id: "c1", external_call_id: "CDR-1", direction: "inbound", started_at: "2026-10-01T10:00:00Z",
  duration_sec: 120, status: "missed", phone_masked: MASKED, has_phone: true, moderator_id: "mod-1",
  recording_path: null, followed_up_at: null, is_sales: true, category: "missed",
};
const HEAVY = ["cm_calls_search_summary", "cm_kpi_missed_calls_v", "cm_calls", "cm_call_analysis_list", "cm_kpi_call_objections"];

const events: string[] = [];
const limits: { table: string; n: number }[] = [];
const deferred: Record<string, (value: Row) => void> = {};

function chain(table: string, factory: () => Promise<Row>) {
  let pending: Promise<Row> | null = null;
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self;
  b.order = self;
  b.in = self;
  b.limit = (n: number) => { limits.push({ table, n }); return b; };
  b.then = (resolve: (v: Row) => unknown, reject: (e: unknown) => unknown) => {
    pending ??= factory();
    return pending.then(resolve, reject);
  };
  return b;
}

function hold(name: string): Promise<Row> {
  return new Promise((resolve) => { deferred[name] = resolve; });
}

function ok(data: unknown): Row {
  return { data, error: null };
}

/** Default GM page: list is held until the test releases it; everything else succeeds. */
function installDefaults(overrides?: { search?: () => Promise<Row>; summary?: () => Promise<Row>; missed?: () => Promise<Row>; analysis?: () => Promise<Row>; objections?: () => Promise<Row>; calls?: () => Promise<Row>; mods?: () => Promise<Row> }) {
  rpc.mockImplementation((name: string) => {
    events.push(name);
    if (name === "cm_calls_search") return (overrides?.search ?? (() => hold("search")))();
    if (name === "cm_calls_search_summary") return (overrides?.summary ?? (() => Promise.resolve(ok([{ calls: 3565, analyzed: 12, avg_score: 4.5, order_pct: 40, open_followups: 3 }]))))();
    if (name === "cm_call_analysis_list") return (overrides?.analysis ?? (() => Promise.resolve(ok([]))))();
    if (name === "cm_kpi_call_objections") return (overrides?.objections ?? (() => Promise.resolve(ok([]))))();
    if (name === "cm_call_order_flags") return Promise.resolve(ok([]));
    return Promise.resolve(ok([]));
  });
  from.mockImplementation((table: string) => {
    events.push(table);
    if (table === "cm_moderators") return chain(table, overrides?.mods ?? (() => Promise.resolve(ok([{ id: "mod-1", display_name: "نورا" }]))));
    if (table === "cm_kpi_missed_calls_v") return chain(table, overrides?.missed ?? (() => Promise.resolve(ok([]))));
    if (table === "cm_calls") return chain(table, overrides?.calls ?? (() => Promise.resolve(ok([{ id: "c1", external_call_id: "CDR-1", phone_norm: MASKED, started_at: "2026-10-01T10:00:00Z" }]))));
    return chain(table, () => Promise.resolve(ok([])));
  });
}

describe("hotline calls loading order", () => {
  beforeEach(() => {
    cleanup();
    roles = ["general_manager"];
    events.length = 0;
    limits.length = 0;
    for (const key of Object.keys(deferred)) delete deferred[key];
    rpc.mockReset();
    from.mockReset();
  });

  it("renders the table when the list returns, and only then starts the heavy reads", async () => {
    installDefaults({
      summary: () => hold("summary"),
      missed: () => hold("missed"),
      analysis: () => hold("analysis"),
    });
    render(<ChatCalls />);

    await waitFor(() => expect(events).toContain("cm_calls_search"));
    expect(events).toContain("cm_moderators");
    expect(events.indexOf("cm_calls_search")).toBeLessThan(events.indexOf("cm_moderators"));
    for (const name of HEAVY) expect(events).not.toContain(name);
    expect(events).not.toContain("cm_call_order_flags");
    expect(screen.getByTestId("calls-table-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("summary-calls-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("call-analysis-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد مكالمات مطابقة")).not.toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل المكالمات — حاول مرة أخرى")).not.toBeInTheDocument();

    await act(async () => { deferred.search(ok([callRow])); });
    expect(await screen.findByText(MASKED)).toBeInTheDocument();
    expect(screen.queryByTestId("calls-table-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByText("لا توجد مكالمات مطابقة")).not.toBeInTheDocument();

    await waitFor(() => {
      for (const name of HEAVY) expect(events).toContain(name);
    });
    const listedAt = events.lastIndexOf("cm_calls_search");
    for (const name of HEAVY) expect(events.indexOf(name)).toBeGreaterThan(listedAt);
    expect(limits).toContainEqual({ table: "cm_kpi_missed_calls_v", n: 2000 });
    expect(limits).toContainEqual({ table: "cm_calls", n: 1000 });
    expect(screen.getByTestId("summary-calls-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("missed-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("call-analysis-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("summary-calls")).not.toBeInTheDocument();

    await act(async () => {
      deferred.summary(ok([{ calls: 3565, analyzed: 12, avg_score: 4.5, order_pct: 40, open_followups: 3 }]));
      deferred.missed(ok([]));
      deferred.analysis(ok([]));
    });
    expect(await screen.findByTestId("summary-calls")).toHaveTextContent("3565");
    expect(screen.getByTestId("summary-followups")).toHaveTextContent("3");
    expect(screen.queryByTestId("missed-skeleton")).not.toBeInTheDocument();
  });

  it("retries the list once on statement timeout before showing an error", async () => {
    let attempts = 0;
    installDefaults({
      search: () => {
        attempts += 1;
        if (attempts === 1) return Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
        return hold("search");
      },
    });
    render(<ChatCalls />);
    await waitFor(() => expect(attempts).toBe(2));
    expect(events.filter((n) => HEAVY.includes(n))).toEqual([]);
    expect(screen.queryByText("تعذّر تحميل المكالمات — حاول مرة أخرى")).not.toBeInTheDocument();
    expect(screen.queryByText("لا توجد مكالمات مطابقة")).not.toBeInTheDocument();

    await act(async () => { deferred.search(ok([callRow])); });
    expect(await screen.findByText(MASKED)).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("retries the list once on a network error, then shows the error state rather than an empty list", async () => {
    let attempts = 0;
    installDefaults({
      search: () => {
        attempts += 1;
        return Promise.reject(new TypeError("Failed to fetch"));
      },
    });
    render(<ChatCalls />);
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل المكالمات — حاول مرة أخرى");
    expect(screen.queryByText("لا توجد مكالمات مطابقة")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-calls")).not.toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(events.filter((n) => HEAVY.includes(n))).toEqual([]);
  });

  it("does not retry a permission failure, and the retry button asks for the list again", async () => {
    let attempts = 0;
    installDefaults({
      search: () => {
        attempts += 1;
        if (attempts > 1) return Promise.resolve(ok([callRow]));
        return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } });
      },
    });
    render(<ChatCalls />);
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل المكالمات — حاول مرة أخرى");
    expect(screen.getByRole("button", { name: "إعادة تحميل المكالمات" })).toBeInTheDocument();
    expect(screen.queryByText("لا توجد مكالمات مطابقة")).not.toBeInTheDocument();
    expect(attempts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل المكالمات" }));
    expect(await screen.findByText(MASKED)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps the loaded rows when summary, missed calls, analysis, and the recording index fail", async () => {
    installDefaults({
      search: () => Promise.resolve(ok([callRow])),
      summary: () => Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }),
      missed: () => Promise.reject(new TypeError("Failed to fetch")),
      analysis: () => Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }),
      objections: () => Promise.reject(new TypeError("Failed to fetch")),
      calls: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    render(<ChatCalls />);
    expect(await screen.findByText(MASKED)).toBeInTheDocument();
    expect(await screen.findByTestId("summary-calls")).toHaveTextContent("—");
    expect(screen.getByTestId("summary-avg")).toHaveTextContent("—");
    expect(screen.getByTestId("summary-order")).toHaveTextContent("—");
    expect(screen.getByTestId("summary-followups")).toHaveTextContent("—");
    expect(screen.getByTestId("summary-calls")).not.toHaveTextContent("0");
    expect(screen.getByTestId("analysis-analyzed")).toHaveTextContent("—");
    expect(screen.getByTestId("analysis-followups")).toHaveTextContent("—");
    expect(screen.getByTestId("objections-error")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد مكالمات مطابقة")).not.toBeInTheDocument();
    expect(screen.queryByText("لم تُتابَع")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة تحميل المؤشرات" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة تحميل تحليل المكالمات" })).toBeInTheDocument();

    const summaryCalls = events.filter((n) => n === "cm_calls_search_summary").length;
    fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل المؤشرات" }));
    await waitFor(() => expect(events.filter((n) => n === "cm_calls_search_summary").length).toBe(summaryCalls + 1));
    expect(screen.getByText(MASKED)).toBeInTheDocument();
    expect(events.filter((n) => n === "cm_calls_search")).toHaveLength(1);
  });

  it("shows an empty list and real zeros when the queries succeed with no rows", async () => {
    installDefaults({
      search: () => Promise.resolve(ok([])),
      summary: () => Promise.resolve(ok([{ calls: 0, analyzed: 0, avg_score: null, order_pct: null, open_followups: 0 }])),
      analysis: () => Promise.resolve(ok([])),
    });
    render(<ChatCalls />);
    expect(await screen.findByTestId("calls-empty")).toHaveTextContent("لا توجد مكالمات مطابقة");
    expect(screen.queryByText("تعذّر تحميل المكالمات — حاول مرة أخرى")).not.toBeInTheDocument();
    expect(await screen.findByTestId("summary-calls")).toHaveTextContent("0");
    expect(screen.getByTestId("summary-followups")).toHaveTextContent("0");
    expect(screen.getByTestId("summary-avg")).toHaveTextContent("—");
    expect(screen.getByTestId("analysis-analyzed")).toHaveTextContent("0");
    expect(screen.getByTestId("analysis-followups")).toHaveTextContent("0");
  });

  it("does not fire the heavy reads for a role that cannot listen or upload", async () => {
    roles = ["marketing_sales_manager"];
    installDefaults({ search: () => Promise.resolve(ok([callRow])) });
    render(<ChatCalls />);
    expect(await screen.findByText(MASKED)).toBeInTheDocument();
    await waitFor(() => expect(events).toContain("cm_calls_search_summary"));
    expect(events).toContain("cm_kpi_missed_calls_v");
    expect(events).not.toContain("cm_calls");
    expect(events).not.toContain("cm_call_analysis_list");
    expect(events).not.toContain("cm_kpi_call_objections");
    expect(screen.queryByTestId("call-analysis-strip")).not.toBeInTheDocument();
  });
});
