import { useEffect, useState } from 'react';
import { findModeratorByName, normalizeAr } from '@/constants/moderators';
import { supabase } from '@/integrations/supabase/client';

/**
 * صورة المسوقة من profiles.avatar_url (نفس الحقل المنسوخ في profile_directory).
 * الملف نفسه في bucket خاص اسمه avatars، فبنطلب رابط موقّع. لو مفيش صورة أو متعذّرش فتحها، نرجّع null.
 */
const matchesModerator = (profileName: string, moderatorName: string) => {
  const normalized = normalizeAr(profileName);
  const moderator = findModeratorByName(moderatorName);
  if (moderator) return moderator.aliases.some((alias) => normalizeAr(alias) === normalized);
  return normalized.length > 0 && normalized === normalizeAr(moderatorName);
};

export function useModeratorAvatar(name: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'photo' | 'missing'>('loading');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('profile_directory').select('full_name, avatar_url');
        if (error) throw error;
        const row = (data ?? []).find((profile) => profile.avatar_url && matchesModerator(profile.full_name, name));
        if (!row?.avatar_url) {
          if (live) setStatus('missing');
          return;
        }
        const signed = await supabase.storage.from('avatars').createSignedUrl(row.avatar_url, 60 * 60);
        if (!live) return;
        if (signed.data?.signedUrl) {
          setUrl(signed.data.signedUrl);
          setStatus('photo');
        } else {
          setStatus('missing');
        }
      } catch {
        if (live) setStatus('missing');
      }
    })();
    return () => {
      live = false;
    };
  }, [name]);

  return { url, status };
}
