/**
 * Account identity hashing for multi-account providers.
 *
 * Several providers can share one usage URL (the same service signed in with different
 * accounts). To decide which entry a capture belongs to, teach records where the account
 * identity sits on the page (an email / display name) and stores only a salted hash of it.
 * The raw text never reaches storage or logs — hashing happens in the background worker so
 * the per-install salt is never handed to a content script.
 */

/** Hex length of a stored account key (128 bits of SHA-256). */
export const ACCOUNT_KEY_HASH_LENGTH = 32;
/** Hex length of the per-install salt. */
export const ACCOUNT_SALT_LENGTH = 64;

export const accountKeyHashPattern = /^[0-9a-f]{32}$/;
export const accountSaltPattern = /^[0-9a-f]{64}$/;

/** Longest identity text we hash — page markup around an email can carry a whole card. */
const MAX_ACCOUNT_TEXT = 200;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Fold whitespace / case so the same account still matches after a re-render that changes
 * spacing (SPA re-mounts frequently reflow the account chip).
 */
export function normalizeAccountText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_ACCOUNT_TEXT);
}

export function createAccountSalt(): string {
  const bytes = new Uint8Array(ACCOUNT_SALT_LENGTH / 2);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Salted hash of an account identity. Returns null when the text carries no identity. */
export async function hashAccountKey(text: string, salt: string): Promise<string | null> {
  const normalized = normalizeAccountText(text);
  if (normalized.length === 0) return null;
  const data = new TextEncoder().encode(`${salt}:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest)).slice(0, ACCOUNT_KEY_HASH_LENGTH);
}
