import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * Listens for new internal_message_recipients rows targeting the current user,
 * fetches sender name, and shows an in-app toast. Mount once at the app shell.
 */
export const useInternalMessageRealtime = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`internal-msg-toast-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "internal_message_recipients",
          filter: `recipient_id=eq.${user.id}`,
        },
        async (payload) => {
          const messageId = (payload.new as any)?.message_id as string | undefined;
          if (!messageId) return;
          const { data: msg } = await (supabase as any)
            .from("internal_messages")
            .select("id, subject, sender_id")
            .eq("id", messageId)
            .maybeSingle();
          if (!msg) return;
          let senderName = "موظف";
          if (msg.sender_id) {
            const { data: p } = await supabase
              .from("profile_directory")
              .select("full_name")
              .eq("id", msg.sender_id)
              .maybeSingle();
            if (p?.full_name) senderName = p.full_name;
          }
          toast(`وصلت رسالة داخلية جديدة من ${senderName}`, {
            description: msg.subject,
            action: {
              label: "فتح",
              onClick: () => navigate(`/internal-messages/${messageId}`),
            },
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, navigate]);
};
