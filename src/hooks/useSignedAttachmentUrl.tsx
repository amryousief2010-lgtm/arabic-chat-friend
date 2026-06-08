import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, { url: string; ts: number }>();
const TTL = 50 * 60 * 1000; // 50 min (signed URL is 1h)

/**
 * Resolves a signed URL for a stored object path in the
 * `internal-message-attachments` bucket. The DB column stores the path
 * relative to the bucket (e.g. "<message_id>/<filename>").
 */
export const useSignedAttachmentUrl = (path: string | null | undefined) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = cache.get(path);
    if (cached && Date.now() - cached.ts < TTL) {
      setUrl(cached.url);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.storage
        .from("internal-message-attachments")
        .createSignedUrl(path, 60 * 60);
      if (cancelled) return;
      if (data?.signedUrl) {
        cache.set(path, { url: data.signedUrl, ts: Date.now() });
        setUrl(data.signedUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return url;
};
