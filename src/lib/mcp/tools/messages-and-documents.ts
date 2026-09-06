import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "messages_and_documents",
  title: "Internal messages & documents",
  description:
    "الرسائل الداخلية (المرسل، الموضوع، الأولوية، الرسائل الإلزامية وحالة الرد) والمرفقات المرتبطة بها، ومستندات الموظفين المسجلة. قراءة بيانات وصفية فقط وفق صلاحيات المستخدم؛ محتوى الملفات نفسه لا يُنزَّل عبر هذا الربط.",
  inputSchema: {
    scope: z
      .enum(["messages", "attachments", "employee_documents", "all"])
      .optional()
      .describe("نطاق القراءة (افتراضي all)."),
    date_from: z.string().optional().describe("من تاريخ YYYY-MM-DD."),
    date_to: z.string().optional().describe("إلى تاريخ YYYY-MM-DD."),
    requires_reply: z.boolean().optional().describe("الرسائل الإلزامية التي تتطلب ردًا فقط."),
    search: z.string().optional().describe("بحث في موضوع الرسالة."),
    limit: z.number().optional().describe("حد الصفوف (افتراضي 100، أقصى 500)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ scope, date_from, date_to, requires_reply, search, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const cap = Math.min(Math.max(limit ?? 100, 1), 500);
    const s = scope ?? "all";
    const wantMsgs = s === "all" || s === "messages";
    const wantAtt = s === "all" || s === "attachments";
    const wantDocs = s === "all" || s === "employee_documents";
    const empty = Promise.resolve({ data: [], error: null } as any);

    let msgQ = supabase
      .from("internal_messages")
      .select("id,sender_id,subject,priority,requires_reply,reply_due_at,has_attachments,is_deleted,created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(cap);
    if (date_from) msgQ = msgQ.gte("created_at", `${date_from}T00:00:00Z`);
    if (date_to) msgQ = msgQ.lte("created_at", `${date_to}T23:59:59Z`);
    if (requires_reply) msgQ = msgQ.eq("requires_reply", true);
    if (search) msgQ = msgQ.ilike("subject", `%${search}%`);

    const [msgs, atts, docs] = await Promise.all([
      wantMsgs ? msgQ : empty,
      wantAtt
        ? supabase
            .from("internal_message_attachments")
            .select("id,message_id,file_name,file_type,file_size,created_at")
            .order("created_at", { ascending: false })
            .limit(cap)
        : empty,
      wantDocs
        ? supabase
            .from("hr_employee_documents")
            .select("id,employee_id,document_type,file_name,file_type,file_size,is_active,uploaded_at")
            .eq("is_active", true)
            .order("uploaded_at", { ascending: false })
            .limit(cap)
        : empty,
    ]);

    const err = msgs.error || atts.error || docs.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };

    const messages = (msgs.data as any[]) ?? [];
    let recipients: any[] = [];
    if (messages.length) {
      const ids = messages.slice(0, 100).map((m) => m.id);
      const { data } = await supabase
        .from("internal_message_recipients")
        .select("message_id,recipient_id,read_at,replied_at")
        .in("message_id", ids)
        .limit(1000);
      recipients = data ?? [];
    }

    const payload = {
      scope: s,
      period: { from: date_from ?? null, to: date_to ?? null },
      messages,
      messages_summary: {
        total: messages.length,
        mandatory: messages.filter((m) => m.requires_reply).length,
        recipients_tracked: recipients.length,
        read: recipients.filter((r) => r.read_at).length,
        replied: recipients.filter((r) => r.replied_at).length,
      },
      recipients,
      attachments: atts.data ?? [],
      employee_documents: docs.data ?? [],
      note: "تُعرض البيانات الوصفية فقط (اسم الملف ونوعه وحجمه) دون روابط تنزيل أو محتوى، والقراءة بصلاحيات المستخدم (RLS).",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
