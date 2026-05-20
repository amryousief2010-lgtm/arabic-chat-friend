// Normalize Egyptian phone numbers to standard local format (01xxxxxxxxx)
// - Converts Arabic-Indic and Persian digits to ASCII digits
// - Strips spaces, dashes, parentheses and other separators
// - Removes country code prefixes (+20 / 0020 / 20) and ensures leading 0
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).trim();

  // Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
       .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

  // Keep only digits and a leading +
  const hasPlus = s.trim().startsWith("+");
  s = s.replace(/[^\d]/g, "");

  // Strip Egyptian country code variants
  if (hasPlus && s.startsWith("20")) s = s.slice(2);
  else if (s.startsWith("0020")) s = s.slice(4);
  else if (s.startsWith("20") && s.length === 12) s = s.slice(2);

  // Ensure leading 0 for local Egyptian mobile (10 digits starting with 1)
  if (s.length === 10 && s.startsWith("1")) s = "0" + s;

  return s;
}
