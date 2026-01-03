-- Add expires_at column to offer_boxes table
ALTER TABLE public.offer_boxes 
ADD COLUMN expires_at timestamp with time zone DEFAULT NULL;

-- Create function to auto-deactivate expired offers
CREATE OR REPLACE FUNCTION public.check_offer_expiry()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE 
    WHEN expires_at IS NULL THEN true
    WHEN expires_at > now() THEN true
    ELSE false
  END
  FROM offer_boxes
  WHERE id = offer_boxes.id
$$;

-- Create function to deactivate expired offers (for cron job)
CREATE OR REPLACE FUNCTION public.deactivate_expired_offers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.offer_boxes
  SET is_active = false
  WHERE expires_at IS NOT NULL 
    AND expires_at <= now() 
    AND is_active = true;
END;
$$;