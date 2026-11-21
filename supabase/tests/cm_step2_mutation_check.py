import subprocess,shutil
M='supabase/migrations/20261025130000_cm_step2_contacts_conversations.sql'
muts={
 'no on-leave cover':("WHERE s.moderator_id <> v_owner ORDER BY m.sort_order","WHERE false ORDER BY m.sort_order"),
 'cover picks last instead of first':("WHERE s.moderator_id <> v_owner ORDER BY m.sort_order, m.slug","WHERE s.moderator_id <> v_owner ORDER BY m.sort_order DESC, m.slug DESC"),
 'undo does not restore phones':("WHERE id IN (SELECT x::uuid FROM jsonb_array_elements_text(m.snapshot->'contact_phones') x);\n  UPDATE public.cm_contacts SET customer_id = m.merged_customer_id","WHERE false;\n  UPDATE public.cm_contacts SET customer_id = m.merged_customer_id"),
 'customer_for_phone ignores merges':("    AND NOT EXISTS (SELECT 1 FROM public.cm_customer_merges mg WHERE mg.merged_customer_id = cp.customer_id AND mg.undone_at IS NULL)\n  ORDER BY lo","  ORDER BY lo"),
 'sync re-links merged customer':("      AND NOT EXISTS (SELECT 1 FROM public.cm_customer_merges mg WHERE mg.merged_customer_id = cu.id AND mg.undone_at IS NULL)),","      ),"),
 'no message dedupe index':("CREATE UNIQUE INDEX IF NOT EXISTS cm_messages_provider_uniq","CREATE INDEX IF NOT EXISTS cm_messages_provider_uniq"),
 'no double-merge guard':("IF EXISTS (SELECT 1 FROM public.cm_customer_merges WHERE merged_customer_id IN (_survivor, _merged)","IF false AND EXISTS (SELECT 1 FROM public.cm_customer_merges WHERE merged_customer_id IN (_survivor, _merged)"),
 'RLS missing on one table':('END $cm_harden$;','END $cm_harden$;\nALTER TABLE public.cm_ad_attributions DISABLE ROW LEVEL SECURITY;'),
}
orig=open(M).read()
try:
  for name,(a,b) in muts.items():
    assert orig.count(a)>=1,name
    open(M,'w').write(orig.replace(a,b,1))
    r=subprocess.run(['sudo','-u','postgres','bash','supabase/tests/run_cm_step2.sh'],capture_output=True,text=True)
    out=r.stdout+r.stderr
    err=[l for l in out.splitlines() if 'ERROR' in l][:1]
    print(('CAUGHT ' if r.returncode else 'SURVIVED ')+name, '|', err[0][:160] if err else '')
finally:
  open(M,'w').write(orig)
