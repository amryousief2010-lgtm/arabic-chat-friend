import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, Check, CheckCheck, Trash2, Package, RefreshCw, ExternalLink, AlertCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface Notification {
  id: string;
  title: string;
  description: string;
  type: string;
  is_read: boolean;
  order_id: string | null;
  created_at: string;
}

// System-generated types that are informational only — anything else attached
// to an order is treated as a manual note that requires an immediate reply.
const INFORMATIONAL_TYPES = new Set(["low_stock", "production_needed"]);

export const requiresImmediateReply = (n: Pick<Notification, "type" | "order_id">) =>
  !!n.order_id && !INFORMATIONAL_TYPES.has(n.type);

const Notifications = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isSalesManager, isGeneralManager, isExecutiveManager } = useAuth();
  const canDecideEditRequests = isSalesManager || isGeneralManager || isExecutiveManager;

  const decideEditRequest = async (orderId: string, approve: boolean, notificationId: string) => {
    try {
      const { error } = await supabase
        .from('order_edit_requests')
        .update({
          status: approve ? 'approved' : 'rejected',
          decided_by: user?.id ?? null,
          decided_at: new Date().toISOString(),
        })
        .eq('order_id', orderId)
        .eq('status', 'pending');
      if (error) throw error;
      await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({ title: approve ? 'تمت الموافقة على تعديل الطلب' : 'تم رفض طلب التعديل' });
    } catch (e: any) {
      console.error(e);
      toast({ title: 'تعذّر تنفيذ الإجراء', description: e?.message, variant: 'destructive' });
    }
  };

  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Notification[];
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
      if (error) throw error;
    },
    // Optimistic update so the UI flips instantly without waiting for a refetch.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueryData<Notification[]>(['notifications']);
      queryClient.setQueryData<Notification[]>(['notifications'], (old) =>
        (old || []).map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['notifications'], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({
        title: "تم التحديث",
        description: "تم تحديد جميع الإشعارات كمقروءة",
      });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({
        title: "تم الحذف",
        description: "تم حذف الإشعار بنجاح",
      });
    },
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const urgentUnreadCount = notifications.filter(n => !n.is_read && requiresImmediateReply(n)).length;

  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [pendingUrgent, setPendingUrgent] = useState<Notification | null>(null);
  const visibleNotifications = useMemo(() => {
    const filtered = showUrgentOnly
      ? notifications.filter(requiresImmediateReply)
      : notifications;
    // Already ordered by created_at desc from the query, but re-sort defensively
    // so the urgent filter never accidentally re-orders.
    return [...filtered].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [notifications, showUrgentOnly]);

  return (
    <DashboardLayout>
      <Header title="سجل الإشعارات" subtitle="جميع الإشعارات السابقة" />

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-sm">
              {unreadCount} غير مقروء
            </Badge>
            {urgentUnreadCount > 0 && (
              <Badge variant="destructive" className="text-sm gap-1 animate-pulse">
                <AlertCircle className="w-3 h-3" />
                {urgentUnreadCount} يتطلب رداً فورياً
              </Badge>
            )}
            <Badge variant="outline" className="text-sm">
              {notifications.length} إجمالي
            </Badge>
            <div className="flex items-center gap-2 pr-2 border-r border-border/50 ms-2">
              <Switch
                id="urgent-only"
                checked={showUrgentOnly}
                onCheckedChange={setShowUrgentOnly}
              />
              <Label htmlFor="urgent-only" className="text-xs cursor-pointer">
                يتطلب رد فقط
              </Label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              تحديث
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllAsReadMutation.mutate()}
                className="gap-2"
              >
                <CheckCheck className="w-4 h-4" />
                تحديد الكل كمقروء
              </Button>
            )}
          </div>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              الإشعارات
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                جاري التحميل...
              </div>
            ) : visibleNotifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{showUrgentOnly ? 'لا توجد إشعارات تتطلب رداً فورياً' : 'لا توجد إشعارات'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleNotifications.map((notification) => {
                  const hasOrder = !!notification.order_id;
                  const urgent = requiresImmediateReply(notification) && !notification.is_read;
                  return (
                  <div
                    key={notification.id}
                    data-testid="notification-item"
                    data-order-id={notification.order_id ?? ''}
                    data-urgent={urgent ? 'true' : 'false'}
                    onClick={() => {
                      if (!hasOrder) return;
                      // For urgent unread notifications, confirm before leaving
                      // so the user doesn't accidentally navigate away from
                      // their current order context.
                      if (urgent) {
                        setPendingUrgent(notification);
                        return;
                      }
                      if (!notification.is_read) {
                        markAsReadMutation.mutate(notification.id);
                      }
                      navigate(`/orders/${notification.order_id}`);
                    }}
                    className={`p-4 rounded-lg border transition-colors ${
                      notification.is_read
                        ? 'bg-background/50 border-border/50'
                        : urgent
                          ? 'bg-destructive/5 border-destructive/40 ring-1 ring-destructive/30'
                          : 'bg-primary/5 border-primary/20'
                    } ${hasOrder ? 'cursor-pointer hover:border-primary/50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`p-2 rounded-full ${
                          urgent
                            ? 'bg-destructive/10 text-destructive'
                            : notification.type === 'new_order'
                              ? 'bg-success/10 text-success'
                              : 'bg-secondary/10 text-secondary'
                        }`}>
                          {urgent ? <AlertCircle className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium">{notification.title}</h4>
                            {!notification.is_read && (
                              <Badge variant={urgent ? 'destructive' : 'default'} className="text-xs">
                                {urgent ? 'يتطلب رد فوري' : 'جديد'}
                              </Badge>
                            )}
                            {hasOrder && (
                              <ExternalLink className="w-3 h-3 text-muted-foreground" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {notification.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {format(new Date(notification.created_at), 'PPpp', { locale: ar })}
                          </p>
                          {notification.type === 'edit_request' && notification.order_id && canDecideEditRequests && !notification.is_read && (
                            <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                className="gap-1"
                                onClick={() => decideEditRequest(notification.order_id!, true, notification.id)}
                              >
                                <Check className="w-4 h-4" /> موافقة على التعديل
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => decideEditRequest(notification.order_id!, false, notification.id)}
                              >
                                رفض
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!notification.is_read && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsReadMutation.mutate(notification.id);
                            }}
                            title="تحديد كمقروء"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotificationMutation.mutate(notification.id);
                          }}
                          className="text-destructive hover:text-destructive"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!pendingUrgent}
        onOpenChange={(open) => { if (!open) setPendingUrgent(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              تأكيد الانتقال لإشعار عاجل
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-medium text-foreground">
                {pendingUrgent?.title}
              </span>
              <span className="block">{pendingUrgent?.description}</span>
              <span className="block text-xs">
                هل تريد الانتقال إلى تفاصيل هذا الطلب الآن وتحديد الإشعار كمقروء؟
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingUrgent) return;
                const n = pendingUrgent;
                if (!n.is_read) markAsReadMutation.mutate(n.id);
                setPendingUrgent(null);
                navigate(`/orders/${n.order_id}`);
              }}
            >
              نعم، انتقل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default Notifications;
