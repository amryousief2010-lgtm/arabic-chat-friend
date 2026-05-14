import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { name, description, category, unit, computed_cost } = await req.json();
    if (!name || typeof name !== 'string') {
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
الوحدة: ${unit || 'قطعة'}
تكلفة الإنتاج الفعلية: ${computed_cost ?? 0} ر.س

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
      const t = await aiRes.text();
      return new Response(JSON.stringify({ error: 'فشل الاتصال بالذكاء الاصطناعي', details: t }), {
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
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
