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
    const { user_id, new_email } = await req.json()
    if (!user_id || !new_email) return json({ error: 'user_id and new_email required' }, 400)

    const { data, error } = await admin.auth.admin.updateUserById(user_id, {
      email: new_email,
      email_confirm: true,
    })
    if (error) return json({ error: error.message }, 500)

    await admin.from('profiles').update({ email: new_email }).eq('id', user_id)

    return json({ success: true, user: data.user }, 200)
  } catch (e: any) {
    return json({ error: e.message ?? 'Internal error' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
