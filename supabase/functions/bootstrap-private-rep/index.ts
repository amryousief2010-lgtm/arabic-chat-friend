import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// One-shot bootstrap: creates the kemo@coceg.net account with the
// private_delivery_rep role. Idempotent — safe to call multiple times.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const email = 'kemo@coceg.net'
    const password = 'Kemo@2026'
    const fullName = 'كيمو جمال'

    // Try to find existing user
    let userId: string | null = null
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = list?.users?.find((u: any) => (u.email || '').toLowerCase() === email)
    if (existing) {
      userId = existing.id
      await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: { full_name: fullName } })
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      })
      if (error || !created.user) {
        return new Response(JSON.stringify({ error: error?.message || 'create failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      userId = created.user.id
    }

    // Ensure role
    await admin.from('user_roles').delete().eq('user_id', userId)
    await admin.from('user_roles').insert({ user_id: userId, role: 'private_delivery_rep' })

    // Ensure profile name
    await admin.from('profiles').upsert({ id: userId, full_name: fullName, email })

    return new Response(JSON.stringify({ ok: true, user_id: userId, email, password }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
