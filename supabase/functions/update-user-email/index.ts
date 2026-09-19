import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  isAuthResponse,
  requireVerifiedUser,
  userHasAnyRole,
} from '../_shared/require-user.ts'

const UPDATE_EMAIL_ALLOWED_ROLES = ['general_manager', 'executive_manager'] as const

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

    const verified = await requireVerifiedUser(req, corsHeaders, admin)
    if (isAuthResponse(verified)) return verified

    const allowed = await userHasAnyRole(admin, verified.user.id, UPDATE_EMAIL_ALLOWED_ROLES)
    if (!allowed) {
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
