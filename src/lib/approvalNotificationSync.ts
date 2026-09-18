/**
 * Keep in-app notification rows in sync with approval lifecycle.
 *
 * Pending-approval notices are created by SQL (duplicate orders, treasury
 * transfer-to-custody, feed production) or the client (order edit requests).
 * Approve/reject historically updated only the approval row, so unread badges
 * stayed stale. Matching rules here are mirrored by
 * supabase/migrations/20260918194600_sync_approval_notifications.sql.
 */

export const APPROVAL_REF_PREFIX = "[ref:";

export const DUPLICATE_APPROVAL_TYPE = "duplicate_order_approval";
export const TREASURY_PENDING_TYPE = "treasury_transfer_pending";
export const FEED_PRODUCTION_APPROVAL_TYPE = "feed_production_approval";
export const EDIT_REQUEST_TYPE = "edit_request";

/** Pending-request titles — NOT the post-decision notices sent to the requester. */
export const DUPLICATE_PENDING_TITLES = [
  "طلب موافقة تسجيل أوردر مكرر",
  "طلب اعتماد أوردر مكرر بانتظارك",
] as const;

export const DUPLICATE_DECISION_TITLES = [
  "تمت الموافقة على الطلب المكرر",
  "تم رفض الطلب المكرر",
  "تمت الموافقة وتسجيل الأوردر",
] as const;

export type ApprovalNotification = {
  id: string;
  type: string;
  title: string;
  description: string;
  is_read: boolean;
  order_id?: string | null;
  created_at?: string | null;
};

export type ApprovalDecisionSpec =
  | {
      kind: "duplicate";
      approvalId: string;
      customerName?: string | null;
      requesterName?: string | null;
    }
  | {
      kind: "treasury";
      txnId: string;
      amountText?: string | null;
      txnCreatedAt?: string | null;
    }
  | { kind: "feed"; prodNo: string }
  | { kind: "edit_request"; orderId: string };

const emptyish = (value?: string | null) => !value || value === "—";

export const approvalRefToken = (id: string) => `${APPROVAL_REF_PREFIX}${id}]`;

export const appendApprovalRef = (description: string, id: string) => {
  const token = approvalRefToken(id);
  if (!id || description.includes(token)) return description;
  return `${description} ${token}`;
};

export const descriptionHasApprovalRef = (description: string, id: string) =>
  !!id && description.includes(approvalRefToken(id));

const withinSeconds = (a?: string | null, b?: string | null, seconds = 15) => {
  if (!a || !b) return false;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return false;
  return Math.abs(da - db) <= seconds * 1000;
};

export const shouldClearApprovalNotification = (
  notification: ApprovalNotification,
  spec: ApprovalDecisionSpec,
): boolean => {
  if (notification.is_read) return false;

  switch (spec.kind) {
    case "duplicate": {
      if (notification.type !== DUPLICATE_APPROVAL_TYPE) return false;
      if ((DUPLICATE_DECISION_TITLES as readonly string[]).includes(notification.title)) {
        return false;
      }
      if (!(DUPLICATE_PENDING_TITLES as readonly string[]).includes(notification.title)) {
        return false;
      }
      if (descriptionHasApprovalRef(notification.description, spec.approvalId)) return true;
      if (emptyish(spec.customerName) || emptyish(spec.requesterName)) return false;
      return (
        notification.description.includes(spec.customerName!) &&
        notification.description.includes(spec.requesterName!)
      );
    }
    case "treasury": {
      if (notification.type !== TREASURY_PENDING_TYPE) return false;
      if (descriptionHasApprovalRef(notification.description, spec.txnId)) return true;
      if (emptyish(spec.amountText)) return false;
      if (!notification.description.includes(spec.amountText!)) return false;
      return withinSeconds(notification.created_at, spec.txnCreatedAt);
    }
    case "feed": {
      if (notification.type !== FEED_PRODUCTION_APPROVAL_TYPE) return false;
      return !!spec.prodNo && notification.description.includes(spec.prodNo);
    }
    case "edit_request": {
      if (notification.type !== EDIT_REQUEST_TYPE) return false;
      return !!spec.orderId && notification.order_id === spec.orderId;
    }
    default:
      return false;
  }
};

export const applyApprovalDecisionToNotifications = (
  notifications: ApprovalNotification[],
  spec: ApprovalDecisionSpec,
): ApprovalNotification[] =>
  notifications.map((notification) =>
    shouldClearApprovalNotification(notification, spec)
      ? { ...notification, is_read: true }
      : notification,
  );
