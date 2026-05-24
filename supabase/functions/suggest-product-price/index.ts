import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const clean = (s: unknown, max = 200) =>
  typeof s === 'string' ? s.replace(/[\r\n`]/g, ' ').slice(0, max) : '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Authenticate caller
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requester }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !requester) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', requester.id);
    const allowed = ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'financial_manager'];
    if (!roles?.some((r: any) => allowed.includes(r.role))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const name = clean(body.name, 200);
    const description = clean(body.description, 500);
    const category = clean(body.category, 100);
    const unit = clean(body.unit, 50) || 'قطعة';
    const computed_cost = Number.isFinite(Number(body.computed_cost)) ? Number(body.computed_cost) : 0;

    if (!name) {
      return new Response(JSON.stringify({ error: 'name مطلوب' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY غير مهيأ' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = `أنت خبير تسعير منتجات الكاترينج في السوق السعودي.

المنتج: ${name}
${description ? `الوصف: ${description}` : ''}
${category ? `الفئة: ${category}` : ''}
الوحدة: ${unit}
تكلفة الإنتاج الفعلية: ${computed_cost} ر.س

اقدّر السعر السوقي لهذا المنتج عند مزودي خدمات الكاترينج المنافسين في السعودية،
ثم اقترح سعر بيع نهائي وهامش ربح مناسب لشركة Sugar in Space (شريحة وسط-عالية).

أعد الرد JSON فقط بدون أي نص آخر بهذه الصيغة:
{
  "market_low": رقم,
  "market_avg": رقم,
  "market_high": رقم,
  "suggested_price": رقم,
  "suggested_margin_pct": رقم,
  "reasoning": "نص قصير بالعربية"
}`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'أرجع JSON صالحًا فقط.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: 'تم تجاوز حد الاستخدام، حاول لاحقًا' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: 'يلزم إضافة رصيد لخدمة الذكاء الاصطناعي' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!aiRes.ok) {
      return new Response(JSON.stringify({ error: 'فشل الاتصال بالذكاء الاصطناعي' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiRes.json();
    let content: string = data?.choices?.[0]?.message?.content ?? '{}';
    content = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content); } catch { parsed = { reasoning: content }; }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
