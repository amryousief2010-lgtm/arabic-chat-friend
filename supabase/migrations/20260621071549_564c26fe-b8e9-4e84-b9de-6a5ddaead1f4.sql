
-- User presence tracking table
CREATE TABLE public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text,
  role text,
  status text NOT NULL DEFAULT 'online',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  current_page text,
  user_agent text,
  session_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can upsert their own row
CREATE POLICY "Users manage own presence insert"
  ON public.user_presence FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own presence update"
  ON public.user_presence FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own presence delete"
  ON public.user_presence FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Managers (general_manager / executive_manager) can read everyone's presence; others read only own
CREATE POLICY "Managers read all presence; others own"
  ON public.user_presence FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  );

CREATE INDEX idx_user_presence_last_seen ON public.user_presence(last_seen_at DESC);
