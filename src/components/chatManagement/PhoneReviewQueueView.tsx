import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dateFormat";
import {
  ISSUE_LABELS,
  ORDER_STATUS_LABELS,
  PHONE_FIELD_LABELS,
  type PhoneField,
  type PhoneReviewIssue,
} from "@/lib/phoneReview";

export interface PhoneReviewOrder {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  total: number | null;
  moderator: string | null;
}

export interface PhoneReviewCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  phone2: string | null;
  edit_fields: PhoneField[];
  order_count: number;
  orders: PhoneReviewOrder[];
}

export interface PhoneReviewItem {
  id: string;
  issue: PhoneReviewIssue;
  phone_raw: string | null;
  phone_norm: string | null;
  created_at: string;
  customers: PhoneReviewCustomer[];
}

export function PhoneReviewQueueView({
  items,
  canCorrect,
  canManage,
  onEdit,
  onDismiss,
  onMerge,
}: {
  items: PhoneReviewItem[];
  canCorrect: boolean;
  canManage: boolean;
  onEdit: (customer: PhoneReviewCustomer, field: PhoneField) => void;
  onDismiss: (item: PhoneReviewItem) => void;
  onMerge: (item: PhoneReviewItem, survivorId: string, mergedId: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="review-queue">
      {items.map((item) => (
        <article key={item.id} className="rounded-lg border border-primary/25 bg-card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-primary text-primary-foreground">{ISSUE_LABELS[item.issue]}</Badge>
            <span dir="ltr" className="font-medium text-accent-foreground">{item.phone_norm ?? item.phone_raw}</span>
          </div>
          <div className="space-y-3">
            {item.customers.map((customer) => (
              <div key={customer.id} className="rounded-md border border-accent/40 bg-accent/5 p-3 space-y-2">
                <div className="font-medium">{customer.name ?? "عميل بدون اسم"}</div>
                <PhoneFieldRow
                  label={PHONE_FIELD_LABELS.phone}
                  value={customer.phone}
                  editable={canCorrect && customer.edit_fields.includes("phone")}
                  onEdit={() => onEdit(customer, "phone")}
                />
                <PhoneFieldRow
                  label={PHONE_FIELD_LABELS.phone2}
                  value={customer.phone2}
                  editable={canCorrect && customer.edit_fields.includes("phone2")}
                  onEdit={() => onEdit(customer, "phone2")}
                />
                <div className="text-sm text-muted-foreground">
                  طلبات الظاهرة {customer.orders.length} من {customer.order_count}
                </div>
                {customer.orders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا طلبات في هذا النطاق</p>
                ) : (
                  <ul className="space-y-1">
                    {customer.orders.map((order) => (
                      <li key={order.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link className="text-primary underline font-medium" to={`/orders/${order.id}`}>
                          {order.order_number}
                        </Link>
                        <span>{formatDate(order.created_at)}</span>
                        <Badge variant="outline">{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
                        {order.total != null && <span>{Number(order.total).toLocaleString("ar-EG")} ج.م</span>}
                        {order.moderator && <span>المسوقة: {order.moderator}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && item.issue === "multi_customer" && item.customers.length === 2 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onMerge(item, customer.id, item.customers.find((other) => other.id !== customer.id)!.id)}
                  >
                    إبقاء هذا ودمج الآخر فيه
                  </Button>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => onDismiss(item)}>تجاهل</Button>
          )}
        </article>
      ))}
    </div>
  );
}

function PhoneFieldRow({
  label,
  value,
  editable,
  onEdit,
}: {
  label: string;
  value: string | null;
  editable: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>
        {label}: <span dir="ltr">{value || "—"}</span>
      </span>
      {editable && (
        <Button type="button" size="sm" variant="outline" className="border-primary text-primary" onClick={onEdit} aria-label={`تعديل ${label}`}>
          <Pencil className="h-3.5 w-3.5" />
          تعديل
        </Button>
      )}
    </div>
  );
}
