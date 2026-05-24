import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Authenticate caller
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: requester }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !requester) return json({ error: 'Unauthorized' }, 401)

    // Only general_manager / executive_manager may change other users' email
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', requester.id)
    const allowed = ['general_manager', 'executive_manager']
    if (!roles?.some((r: any) => allowed.includes(r.role))) {
      return json({ error: 'Forbidden' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const { user_id, new_email } = body
    if (!user_id || typeof user_id !== 'string') return json({ error: 'user_id required' }, 400)
    if (!new_email || typeof new_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
      return json({ error: 'valid new_email required' }, 400)
    }

    const { data, error } = await admin.auth.admin.updateUserById(user_id, {
      email: new_email,
      email_confirm: true,
    })
    if (error) return json({ error: error.message }, 500)

    await admin.from('profiles').update({ email: new_email }).eq('id', user_id)

    return json({ success: true, user: data.user }, 200)
  } catch (e: any) {
    console.error(e)
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
