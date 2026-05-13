import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: requester }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !requester) return json({ error: 'Unauthorized' }, 401)

    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', requester.id)
    const allowed = ['general_manager', 'executive_manager', 'sales_manager']
    if (!roles?.some((r: any) => allowed.includes(r.role))) {
      return json({ error: 'Not authorized to create employees' }, 403)
    }

    const { email, password, full_name, role } = await req.json()
    if (!email || !password || !full_name) return json({ error: 'email, password, full_name required' }, 400)

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (createErr || !created.user) return json({ error: createErr?.message || 'Failed to create user' }, 500)

    // handle_new_user trigger inserts profile + default sales_moderator role.
    // If a different role is requested, update it.
    if (role && role !== 'sales_moderator') {
      await admin.from('user_roles').update({ role }).eq('user_id', created.user.id)
    }

    return json({ success: true, user_id: created.user.id }, 200)
  } catch (e) {
    console.error(e)
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
