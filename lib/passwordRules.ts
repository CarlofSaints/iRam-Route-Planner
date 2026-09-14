/**
 * The one rule for a password this app will accept, wherever it is set: the
 * forced change at first sign-in, a reset link, the profile page, and an admin
 * setting one for somebody else.
 *
 * It lives in its own file with no imports so the browser pages can use the
 * same function the server does. It used to sit in lib/passwordReset.ts, which
 * pulls in Node's crypto, and every other screen had grown its own "at least 6"
 * check instead. So a rep could choose a password at first sign-in that the
 * reset page would then refuse.
 *
 * Only ever checked when a password is SET. Existing passwords that pre-date the
 * rule still sign in.
 */

/** Shown under a new-password field, so the rule is known before it is broken. */
export const PASSWORD_HINT = "At least 8 characters, with a letter and a number.";

/** A reason the password would be refused, or null if it is fine. */
export function passwordProblem(password: string): string | null {
  if (!password || password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That is too long.";
  if (!/[a-zA-Z]/.test(password)) return "Include at least one letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  return null;
}
