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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
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
      <Header title="سجل الإشعارات" subtitle="جميع الإشعارات السابقة" />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm">
              {unreadCount} غير مقروء
            </Badge>
            <Badge variant="outline" className="text-sm">
              {notifications.length} إجمالي
            </Badge>
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
            ) : notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>لا توجد إشعارات</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((notification) => {
                  const hasOrder = !!notification.order_id;
                  return (
                  <div
                    key={notification.id}
                    onClick={() => {
                      if (hasOrder) {
                        if (!notification.is_read) {
                          markAsReadMutation.mutate(notification.id);
                        }
                        // Navigate directly to the order so the user can read the
                        // attached note and respond to it immediately.
                        navigate(`/orders/${notification.order_id}`);
                      }
                    }}
                    className={`p-4 rounded-lg border transition-colors ${
                      notification.is_read
                        ? 'bg-background/50 border-border/50'
                        : 'bg-primary/5 border-primary/20'
                    } ${hasOrder ? 'cursor-pointer hover:border-primary/50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`p-2 rounded-full ${
                          notification.type === 'new_order' 
                            ? 'bg-success/10 text-success' 
                            : 'bg-secondary/10 text-secondary'
                        }`}>
                          <Package className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium">{notification.title}</h4>
                            {!notification.is_read && (
                              <Badge variant="default" className="text-xs">
                                جديد
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
    </DashboardLayout>
  );
};

export default Notifications;
