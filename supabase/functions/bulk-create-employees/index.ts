import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMPLOYEES = [
  {
    email: 'ahmed.elgamal@naam-capital.com',
    password: 'Naam@2026!Ahmed',
    full_name: 'أحمد الجمل',
    role: 'executive_manager',
  },
  {
    email: 'elsayed.elgamal@naam-capital.com',
    password: 'Naam@2026!Elsayed',
    full_name: 'السيد الجمل',
    role: 'production_manager',
  },
  {
    email: 'alaa.hamed@naam-capital.com',
    password: 'Naam@2026!Alaa',
    full_name: 'آلاء حامد',
    role: 'marketing_sales_manager',
  },
  {
    email: 'khaled.elgenzouri@naam-capital.com',
    password: 'Naam@2026!Khaled',
    full_name: 'خالد الجنزوري',
    role: 'financial_manager',
  },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const results: any[] = [];

    for (const emp of EMPLOYEES) {
      try {
        const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = existing.users.find((u: any) => u.email === emp.email);

        let userId: string;
        if (found) {
          userId = found.id;
          // Update password to ensure it's known
          await admin.auth.admin.updateUserById(userId, {
            password: emp.password,
            email_confirm: true,
            user_metadata: { full_name: emp.full_name },
          });
          results.push({ email: emp.email, status: 'updated', id: userId });
        } else {
          const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email: emp.email,
            password: emp.password,
            email_confirm: true,
            user_metadata: { full_name: emp.full_name },
          });
          if (createErr || !created.user) throw createErr ?? new Error('Create failed');
          userId = created.user.id;
          results.push({ email: emp.email, status: 'created', id: userId });
        }

        await admin.from('profiles').upsert({
          id: userId,
          full_name: emp.full_name,
          email: emp.email,
        });

        await admin.from('user_roles').delete().eq('user_id', userId);
        const { error: roleErr } = await admin
          .from('user_roles')
          .insert({ user_id: userId, role: emp.role });
        if (roleErr) throw roleErr;
      } catch (e: any) {
        results.push({ email: emp.email, status: 'error', error: e.message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
