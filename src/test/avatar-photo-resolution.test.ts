import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: () => ({}), getSession: async () => ({ data: { session: null } }) } } }));
import { normalizeArabicName, resolveAvatarUrl, signAvatarPaths, __setAvatarStoresForTest } from "@/hooks/useAvatars";

describe("avatar resolution", () => {
  it("normalizes Arabic names and titles", () => {
    expect(normalizeArabicName("أ. أحمد الجمل")).toBe("احمد الجمل");
    expect(normalizeArabicName("عمرو يوسف ")).toBe("عمرو يوسف");
    expect(normalizeArabicName("آية")).toBe(normalizeArabicName("اية"));
  });
  it("prefers linked account photo, then HR photo, then name match", () => {
    __setAvatarStoresForTest({
      store: { u1: { path: "a", url: "acct.png" }, u2: { path: "b", url: "amr.png" } },
      employeeStore: { e1: { userId: "u1", url: "hr1.png" }, e2: { userId: null, url: "hr2.png" }, e3: { userId: null, url: null } },
      nameStore: { [normalizeArabicName("عمرو يوسف")]: "u2" },
    });
    expect(resolveAvatarUrl(null, "e1")).toBe("acct.png");
    expect(resolveAvatarUrl(null, "e2")).toBe("hr2.png");
    expect(resolveAvatarUrl(null, "e3")).toBeNull();
    expect(resolveAvatarUrl(null, null, ["عمرو يوسف"])).toBe("amr.png");
  });
  it("one failing signing batch does not drop the others", async () => {
    const paths = Array.from({ length: 120 }, (_, i) => `p${i}`);
    let n = 0;
    const map = await signAvatarPaths(paths, async (chunk) => {
      n++;
      if (n === 2) throw new Error("boom");
      return { data: chunk.map((p) => ({ path: p, signedUrl: "s/" + p })), error: null };
    });
    expect(map.size).toBe(70);
    expect(map.get("p0")).toBe("s/p0");
  });
});
