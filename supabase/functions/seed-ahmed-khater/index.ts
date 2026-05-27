// One-shot idempotent seeder for Ahmed Khater (Agouza warehouse keeper).
// Safe to call multiple times; will be a no-op if account already exists.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL = 'ahmed.khater@coceg.net'
const PASSWORD = 'Khater@2026'
const FULL_NAME = 'أحمد خاطر'
const ROLE = 'agouza_warehouse_keeper'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Check if user exists by listing users with that email
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    let user = existing?.users?.find((u: any) => u.email?.toLowerCase() === EMAIL.toLowerCase())

    if (!user) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: FULL_NAME },
      })
      if (createErr || !created.user) {
        return json({ error: createErr?.message || 'createUser failed' }, 500)
      }
      user = created.user
    }

    // Ensure profile exists/updated
    await admin.from('profiles').upsert(
      { id: user.id, email: EMAIL, full_name: FULL_NAME },
      { onConflict: 'id' },
    )

    // Ensure role is set
    await admin.from('user_roles').delete().eq('user_id', user.id)
    await admin.from('user_roles').insert({ user_id: user.id, role: ROLE })

    return json({ ok: true, user_id: user.id, email: EMAIL, password: PASSWORD, role: ROLE }, 200)
  } catch (e: any) {
    console.error(e)
    return json({ error: e?.message || 'internal' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
