UPDATE public.orders o
SET status = s.status, updated_at = now()
FROM public.apr_stage s
WHERE o.created_at >= '2026-04-01' AND o.created_at < '2026-05-02'
  AND abs(extract(epoch from (o.created_at - s.ts))) < 2
  AND o.status IS DISTINCT FROM s.status;

DROP TABLE public.apr_stage;