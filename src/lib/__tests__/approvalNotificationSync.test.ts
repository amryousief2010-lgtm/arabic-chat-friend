import { describe, it, expect } from "vitest";
import {
  appendApprovalRef,
  applyApprovalDecisionToNotifications,
  approvalRefToken,
  DUPLICATE_DECISION_TITLES,
  DUPLICATE_PENDING_TITLES,
  shouldClearApprovalNotification,
  type ApprovalNotification,
} from "../approvalNotificationSync";

const n = (partial: Partial<ApprovalNotification> & Pick<ApprovalNotification, "id" | "type" | "title">): ApprovalNotification => ({
  description: "",
  is_read: false,
  order_id: null,
  created_at: "2026-09-18T10:00:00.000Z",
  ...partial,
});

describe("approvalRefToken / appendApprovalRef", () => {
  it("embeds a stable [ref:uuid] token once", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(approvalRefToken(id)).toBe(`[ref:${id}]`);
    const once = appendApprovalRef("طلب توريد جديد", id);
    expect(once).toBe(`طلب توريد جديد [ref:${id}]`);
    expect(appendApprovalRef(once, id)).toBe(once);
  });
});

describe("duplicate_order_approval — decide must clear pending, not decision notices", () => {
  const approvalId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const pending = n({
    id: "p1",
    type: "duplicate_order_approval",
    title: DUPLICATE_PENDING_TITLES[0],
    description: appendApprovalRef("المودريتور نورا تطلب موافقة لتسجيل طلب مكرر للعميل أحمد", approvalId),
  });
  const pendingLegacy = n({
    id: "p2",
    type: "duplicate_order_approval",
    title: DUPLICATE_PENDING_TITLES[0],
    description: "المودريتور نورا تطلب موافقة لتسجيل طلب مكرر للعميل أحمد",
  });
  const otherCustomer = n({
    id: "p3",
    type: "duplicate_order_approval",
    title: DUPLICATE_PENDING_TITLES[0],
    description: "المودريتور سارة تطلب موافقة لتسجيل طلب مكرر للعميل محمود",
  });
  const decision = n({
    id: "d1",
    type: "duplicate_order_approval",
    title: DUPLICATE_DECISION_TITLES[0],
    description: "يمكنك تسجيل الطلب الآن.",
  });

  const spec = {
    kind: "duplicate" as const,
    approvalId,
    customerName: "أحمد",
    requesterName: "نورا",
  };

  it("clears the pending request notice (ref token or requester+customer fallback)", () => {
    expect(shouldClearApprovalNotification(pending, spec)).toBe(true);
    expect(shouldClearApprovalNotification(pendingLegacy, spec)).toBe(true);
  });

  it("does not clear another pending request or the requester's decision notice", () => {
    expect(shouldClearApprovalNotification(otherCustomer, spec)).toBe(false);
    expect(shouldClearApprovalNotification(decision, spec)).toBe(false);
  });

  it("leaves already-read rows untouched", () => {
    expect(shouldClearApprovalNotification({ ...pending, is_read: true }, spec)).toBe(false);
  });
});

describe("treasury_transfer_pending — approve/reject must clear the pending notice", () => {
  const txnId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const spec = {
    kind: "treasury" as const,
    txnId,
    amountText: "30,000.00",
    txnCreatedAt: "2026-09-18T10:00:00.000Z",
  };

  it("matches by [ref:txnId]", () => {
    const row = n({
      id: "t1",
      type: "treasury_transfer_pending",
      title: "طلب توريد جديد بانتظار الاعتماد",
      description: appendApprovalRef("يوجد طلب توريد جديد بمبلغ 30,000.00 ج.م", txnId),
    });
    expect(shouldClearApprovalNotification(row, spec)).toBe(true);
  });

  it("falls back to amount + created_at window for legacy rows without [ref]", () => {
    const row = n({
      id: "t2",
      type: "treasury_transfer_pending",
      title: "طلب توريد جديد بانتظار الاعتماد",
      description: "يوجد طلب توريد جديد بمبلغ 30,000.00 ج.م بانتظار الاعتماد",
      created_at: "2026-09-18T10:00:08.000Z",
    });
    expect(shouldClearApprovalNotification(row, spec)).toBe(true);
  });

  it("does not clear a same-amount notice from a different transfer", () => {
    const row = n({
      id: "t3",
      type: "treasury_transfer_pending",
      title: "طلب توريد جديد بانتظار الاعتماد",
      description: "يوجد طلب توريد جديد بمبلغ 30,000.00 ج.م بانتظار الاعتماد",
      created_at: "2026-09-17T08:00:00.000Z",
    });
    expect(shouldClearApprovalNotification(row, spec)).toBe(false);
  });
});

describe("feed_production_approval / edit_request", () => {
  it("clears the feed notice whose description contains prod_no", () => {
    const row = n({
      id: "f1",
      type: "feed_production_approval",
      title: "فاتورة تصنيع علف بانتظار الاعتماد",
      description: "فاتورة PROD-180926120000001 — علف تسمين بكمية 500 كجم",
    });
    expect(shouldClearApprovalNotification(row, { kind: "feed", prodNo: "PROD-180926120000001" })).toBe(true);
    expect(shouldClearApprovalNotification(row, { kind: "feed", prodNo: "PROD-OTHER" })).toBe(false);
  });

  it("clears every unread edit_request for the decided order, not other orders", () => {
    const rows = [
      n({
        id: "e1",
        type: "edit_request",
        title: "طلب إذن تعديل",
        order_id: "order-1",
      }),
      n({
        id: "e2",
        type: "edit_request",
        title: "طلب إذن تعديل",
        order_id: "order-1",
      }),
      n({
        id: "e3",
        type: "edit_request",
        title: "طلب إذن تعديل",
        order_id: "order-2",
      }),
    ];
    const next = applyApprovalDecisionToNotifications(rows, { kind: "edit_request", orderId: "order-1" });
    expect(next.filter((r) => r.is_read).map((r) => r.id)).toEqual(["e1", "e2"]);
    expect(next.find((r) => r.id === "e3")?.is_read).toBe(false);
  });
});
