CREATE TABLE public.ai_assistant_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  module text,
  date_from date,
  date_to date,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ai_assistant_query_log TO authenticated;
GRANT ALL ON public.ai_assistant_query_log TO service_role;

ALTER TABLE public.ai_assistant_query_log ENABLE ROW LEVEL SECURITY;

-- Users can insert their own log entries
CREATE POLICY "users_insert_own_ai_log" ON public.ai_assistant_query_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own log entries
CREATE POLICY "users_read_own_ai_log" ON public.ai_assistant_query_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- General/Executive managers can read all log entries for audit oversight
CREATE POLICY "managers_read_all_ai_log" ON public.ai_assistant_query_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  );

CREATE INDEX idx_ai_log_user_created ON public.ai_assistant_query_log(user_id, created_at DESC);
CREATE INDEX idx_ai_log_created ON public.ai_assistant_query_log(created_at DESC);