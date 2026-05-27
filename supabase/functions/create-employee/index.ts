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
    const requesterRoles: string[] = (roles ?? []).map((r: any) => r.role)
    const allowed = ['general_manager', 'executive_manager', 'sales_manager']
    if (!requesterRoles.some((r) => allowed.includes(r))) {
      return json({ error: 'Not authorized to create employees' }, 403)
    }

    const { email, password, full_name, role } = await req.json()
    if (!email || !password || !full_name) return json({ error: 'email, password, full_name required' }, 400)

    // Build allowlist of roles the requester may assign — prevents privilege escalation.
    const VALID_ROLES = [
      'general_manager', 'executive_manager', 'sales_manager',
      'warehouse_manager', 'warehouse_supervisor', 'accountant',
      'sales_moderator', 'private_delivery_rep', 'shipping_company',
      'agouza_warehouse_keeper',
    ]
    let assignable: string[] = []
    if (requesterRoles.includes('general_manager')) {
      assignable = VALID_ROLES
    } else if (requesterRoles.includes('executive_manager')) {
      assignable = VALID_ROLES.filter((r) => r !== 'general_manager')
    } else if (requesterRoles.includes('sales_manager')) {
      assignable = ['sales_moderator', 'private_delivery_rep', 'shipping_company']
    }

    const finalRole = role || 'sales_moderator'
    if (!assignable.includes(finalRole)) {
      return json({ error: 'You are not allowed to assign this role' }, 403)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (createErr || !created.user) return json({ error: createErr?.message || 'Failed to create user' }, 500)

    // handle_new_user trigger inserts profile + default sales_moderator role.
    // If a different role is requested, update it.
    if (finalRole !== 'sales_moderator') {
      await admin.from('user_roles').update({ role: finalRole }).eq('user_id', created.user.id)
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
