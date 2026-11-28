import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VoiceAssistantFab from "@/components/aiAssistant/VoiceAssistantFab";
import VoiceAssistantPanel from "@/components/aiAssistant/VoiceAssistantPanel";

const auth = vi.hoisted(() => ({ user: { id: "gm-1" } as { id: string } | null, roles: ["general_manager"] as string[] }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/useCompactFloating", () => ({ useCompactFloating: () => false }));

describe("VoiceAssistantFab", () => {
  beforeEach(() => {
    localStorage.clear();
    auth.user = { id: "gm-1" };
    auth.roles = ["general_manager"];
  });

  it("hides for roles outside GM / executive / sales manager", () => {
    auth.roles = ["financial_manager"];
    render(<MemoryRouter><VoiceAssistantFab /></MemoryRouter>);
    expect(screen.queryByTestId("voice-fab")).toBeNull();
    expect(screen.queryByTestId("voice-fab-tab")).toBeNull();
  });

  it("shows the floating mic for the sales manager, opens the panel, and can be hidden then shown again", () => {
    auth.roles = ["sales_manager"];
    render(<MemoryRouter><VoiceAssistantFab /></MemoryRouter>);
    expect(screen.getByTestId("voice-fab")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("voice-fab"));
    expect(screen.getByTestId("voice-fab-panel")).toBeInTheDocument();
    expect(screen.getByTestId("voice-fab-mic")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("voice-fab-hide"));
    expect(screen.queryByTestId("voice-fab-panel")).toBeNull();
    expect(screen.getByTestId("voice-fab-tab")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("voice-fab-tab"));
    expect(screen.getByTestId("voice-fab-panel")).toBeInTheDocument();
  });
});

describe("VoiceAssistantPanel", () => {
  it("keeps the page mic and title so /ai-operations-assistant is unchanged", () => {
    render(<MemoryRouter><VoiceAssistantPanel /></MemoryRouter>);
    expect(screen.getByTestId("voice-mic")).toBeInTheDocument();
    expect(screen.getByText("مساعد نعام الصوتي")).toBeInTheDocument();
    expect(screen.getByTestId("voice-turns")).toBeInTheDocument();
  });
});
