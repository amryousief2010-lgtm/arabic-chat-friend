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

    const employees = [
      { email: 'aya@coceg.net', password: 'Aya@2026', full_name: 'آية' },
      { email: 'noura@coceg.net', password: 'Noura@2026', full_name: 'نورا' },
      { email: 'sara@coceg.net', password: 'Sara@2026', full_name: 'سارة' },
    ]

    const results = []
    for (const emp of employees) {
      try {
        const { data: existing } = await admin.auth.admin.listUsers()
        const alreadyExists = existing.users.some((u: any) => u.email === emp.email)
        if (alreadyExists) {
          results.push({ email: emp.email, status: 'already_exists' })
          continue
        }

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: emp.email,
          password: emp.password,
          email_confirm: true,
          user_metadata: { full_name: emp.full_name },
        })

        if (createErr) {
          results.push({ email: emp.email, status: 'error', error: createErr.message })
        } else {
          results.push({ email: emp.email, status: 'created', user_id: created.user?.id })
        }
      } catch (err: any) {
        results.push({ email: emp.email, status: 'error', error: err.message })
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error(e)
    return new Response(JSON.stringify({ error: 'Internal error', details: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
