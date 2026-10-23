import type { User } from '@supabase/supabase-js';

/**
 * A user created by management with a temporary password carries
 * `user_metadata.must_change_password = true`. Until she sets her own
 * password, every protected screen is replaced by the force-change page.
 */
export const MUST_CHANGE_PASSWORD_KEY = 'must_change_password';

export const mustChangePassword = (user: Pick<User, 'user_metadata'> | null | undefined): boolean => {
  const v = user?.user_metadata?.[MUST_CHANGE_PASSWORD_KEY];
  return v === true || v === 'true';
};

export const MIN_PASSWORD_LENGTH = 8;

/** Returns an Arabic error message, or null when the new password is acceptable. */
export const validateNewPassword = (password: string, confirm: string): string | null => {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `كلمة السر لازم تكون ${MIN_PASSWORD_LENGTH} حروف أو أرقام على الأقل`;
  }
  if (!/[A-Za-z\u0600-\u06FF]/.test(password) || !/\d/.test(password)) {
    return 'كلمة السر لازم يكون فيها حروف وأرقام مع بعض';
  }
  if (password !== confirm) {
    return 'كلمتا السر مش متطابقتين';
  }
  return null;
};
