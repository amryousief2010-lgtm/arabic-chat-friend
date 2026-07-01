
ALTER TABLE public.social_media_daily_reports
  ADD COLUMN IF NOT EXISTS reach_count INTEGER,
  ADD COLUMN IF NOT EXISTS impressions_count INTEGER,
  ADD COLUMN IF NOT EXISTS likes_count INTEGER,
  ADD COLUMN IF NOT EXISTS comments_count INTEGER,
  ADD COLUMN IF NOT EXISTS shares_count INTEGER,
  ADD COLUMN IF NOT EXISTS new_followers_count INTEGER,
  ADD COLUMN IF NOT EXISTS platforms TEXT[];
