import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmployeeInput {
  email: string;
  password: string;
  full_name: string;
  role: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller is general_manager
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'general_manager')
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden: general_manager only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const employees: EmployeeInput[] = body.employees;
    if (!Array.isArray(employees) || employees.length === 0) {
      return new Response(JSON.stringify({ error: 'employees array required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: any[] = [];
    for (const emp of employees) {
      try {
        // Check if user already exists
        const { data: existing } = await admin.auth.admin.listUsers();
        const found = existing.users.find((u: any) => u.email === emp.email);

        let userId: string;
        if (found) {
          userId = found.id;
          results.push({ email: emp.email, status: 'exists', id: userId });
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

        // Ensure profile
        await admin.from('profiles').upsert({
          id: userId,
          full_name: emp.full_name,
          email: emp.email,
        });

        // Set role (delete default & insert correct one)
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
