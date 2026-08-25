/**
 * The one place the welcome email is built and sent.
 *
 * Two callers, with deliberately DIFFERENT password behaviour:
 *
 *   POST /api/users              a brand new user, emailed the password the
 *                                admin typed. Nothing is reset — what was typed
 *                                is what arrives.
 *
 *   POST /api/users/send-welcome a re-send, which MINTS a new temp password and
 *                                overwrites the existing one. That is why it
 *                                must never be fired at a live account casually.
 *
 * Nothing here throws. A mail failure must not roll back a user that was
 * created successfully, so every path returns a result the caller can report
 * back to the screen.
 */

const BRAND = {
  green: "#7CC042",
  greenDark: "#5a9a2e",
  greenLight: "#e8f5d9",
  greenLighter: "#f3fae9",
  dark: "#32373C",
  grey: "#828282",
} as const;

export type WelcomeEmailResult =
  | { sent: true }
  | { sent: false; configured: boolean; reason: string };

export interface WelcomeEmailInput {
  name: string;
  email: string;
  /** Plain text, only ever held in memory for the length of the request. */
  password: string;
  /** Whether the recipient will be forced to change it on first sign-in. */
  forcePasswordChange: boolean;
  /**
   * Who is being written to. A rep's login exists for one reason — to capture
   * where they live — so their mail says that instead of describing an app they
   * cannot otherwise use. Defaults to the original wording.
   */
  audience?: "admin" | "rep";
}

export function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://i-ram-route-planner.vercel.app";
}

/** A name or email carrying `<` or `&` must not be able to break the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildWelcomeEmail(input: WelcomeEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = resolveAppUrl();
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const password = escapeHtml(input.password);

  // The logo is grey on transparent, so every panel behind it stays light.
  const logoUrl = `${appUrl}/iram-logo.png`;

  const passwordNote = input.forcePasswordChange
    ? "You'll be asked to choose your own password the first time you sign in."
    : "Please change this to something only you know once you're in.";

  const isRep = input.audience === "rep";

  // A rep has nowhere else to go, so send them straight at their profile. The
  // middleware redirects them there anyway; landing on it directly just saves
  // them a hop and matches what the instructions below tell them to open.
  const signInUrl = isRep ? `${appUrl}/account` : appUrl;

  const headline = isRep ? "Set where your day starts" : "Welcome to the Route Planner";
  const subhead = isRep ? "It takes about a minute" : "Your account is ready";
  const buttonLabel = isRep ? "Sign in and set your home address" : "Sign in to iRam Route Planner";

  const intro = isRep
    ? `An account has been created for you on <strong>iRam Route Planner</strong>, the system that plans your call cycle. ` +
      `Please sign in and tell us where you live — your route is planned outwards from your home, so the closer it is to ` +
      `your front door, the less driving you do.`
    : `An account has been created for you on <strong>iRam Route Planner</strong> — where call cycles, rep journeys and ` +
      `store allocations are planned. Here are your sign-in details.`;

  // The one instruction that makes the login worth sending at all.
  const repInstructions = isRep
    ? `
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenLighter};border:1px solid ${BRAND.greenLight};border-radius:10px;">
                  <tr>
                    <td style="padding:16px 20px 18px 20px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:${BRAND.dark};">
                      <strong style="font-size:14px;">Once you're signed in</strong><br>
                      1. Open <strong>Account</strong>.<br>
                      2. Find <strong>Where your day starts</strong>.<br>
                      3. Standing at home, tap <strong>Use my current location</strong>.<br>
                      <span style="color:${BRAND.grey};">That last step is the important one — it pins your home exactly, even if your address is hard to find on a map.</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : "";

  const row = (label: string, value: string, mono = false) => `
              <tr>
                <td style="padding:10px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${BRAND.grey};">${label}</td>
              </tr>
              <tr>
                <td style="padding:2px 0 0 0;font-family:${mono ? "'SF Mono',Consolas,Menlo,monospace" : "Helvetica,Arial,sans-serif"};font-size:${mono ? "17px" : "15px"};font-weight:${mono ? "bold" : "normal"};color:${BRAND.dark};letter-spacing:${mono ? ".02em" : "normal"};word-break:break-all;">${value}</td>
              </tr>`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${isRep ? "Set where your day starts" : "Welcome to iRam Route Planner"}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.greenLighter};">
    <!-- preview text, hidden in the body but shown in the inbox list -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${
      isRep
        ? "Your sign-in details are inside — please tell us where you live."
        : "Your iRam Route Planner sign-in details are inside."
    }</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenLighter};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e6ebe0;border-radius:14px;overflow:hidden;">

            <tr>
              <td align="center" style="padding:30px 32px 22px 32px;background:#ffffff;">
                <img src="${logoUrl}" alt="iRam" width="120" style="display:block;border:0;outline:none;text-decoration:none;width:120px;height:auto;">
              </td>
            </tr>
            <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.green};">&nbsp;</td></tr>

            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">${headline}</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">${subhead}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0;">${intro}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenLighter};border:1px solid ${BRAND.greenLight};border-radius:10px;">
                  <tr>
                    <td style="padding:18px 20px 20px 20px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${row("Email", email)}
${row("Temporary password", password, true)}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:26px 32px 6px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="background:${BRAND.green};border-radius:8px;">
                      <a href="${signInUrl}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${buttonLabel}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:12px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.grey};">
                or paste this into your browser:<br>
                <a href="${signInUrl}" style="color:${BRAND.greenDark};text-decoration:none;">${signInUrl}</a>
              </td>
            </tr>
${repInstructions}

            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${BRAND.green};">
                  <tr>
                    <td style="padding:2px 0 2px 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.dark};">
                      ${passwordNote} Keep this email private until you have — anyone with the password above can sign in as you.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0;">Regards,<br><strong>The iRam Team</strong></p>
              </td>
            </tr>

            <tr>
              <td style="padding:26px 32px 26px 32px;">
                <div style="height:1px;background:#eef1ea;font-size:0;line-height:0;">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 32px 28px 32px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:${BRAND.grey};">
                You're receiving this because an administrator created an account for you.<br>
                If that wasn't expected, please tell your administrator and don't sign in.
              </td>
            </tr>

          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:16px 12px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${BRAND.grey};">
                iRam Route Planner &middot; Powered by OuterJoin
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${input.name},`,
    ``,
    isRep
      ? `An account has been created for you on iRam Route Planner, the system that plans your call cycle. Please sign in and tell us where you live — your route is planned outwards from your home, so the closer it is to your front door, the less driving you do.`
      : `An account has been created for you on iRam Route Planner.`,
    ``,
    `Sign-in URL: ${signInUrl}`,
    `Email:       ${input.email}`,
    `Password:    ${input.password}`,
    ``,
    ...(isRep
      ? [
          `Once you're signed in:`,
          `  1. Open Account.`,
          `  2. Find "Where your day starts".`,
          `  3. Standing at home, tap "Use my current location".`,
          ``,
          `That last step is the important one — it pins your home exactly, even if your address is hard to find on a map.`,
          ``,
        ]
      : []),
    passwordNote,
    `Keep this email private until you have — anyone with the password above can sign in as you.`,
    ``,
    `Regards,`,
    `The iRam Team`,
    ``,
    `You're receiving this because an administrator created an account for you.`,
    `If that wasn't expected, please tell your administrator and don't sign in.`,
  ].join("\n");

  return {
    subject: isRep
      ? "Your iRam Route Planner login — please set your home address"
      : "Welcome to iRam Route Planner",
    html,
    text,
  };
}

export interface PasswordResetEmailInput {
  name: string;
  email: string;
  /** The full link, already carrying the token. */
  resetUrl: string;
  expiryMinutes: number;
}

/**
 * The "you asked to reset your password" mail.
 *
 * It carries a LINK and never a password. It could not carry a password: they
 * are stored as bcrypt hashes and a hash is one way, so there is nothing to send
 * even if it were a good idea. The person chooses their own at the other end.
 *
 * The logo is grey on transparent, so every panel behind it stays light. A
 * charcoal header would swallow it.
 */
export function buildPasswordResetEmail(input: PasswordResetEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = resolveAppUrl();
  const name = escapeHtml(input.name);
  const url = escapeHtml(input.resetUrl);
  const logoUrl = `${appUrl}/iram-logo.png`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Reset your iRam Route Planner password</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.greenLighter};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Choose a new password. The link works for ${input.expiryMinutes} minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenLighter};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e6ebe0;border-radius:14px;overflow:hidden;">

            <tr>
              <td align="center" style="padding:30px 32px 22px 32px;background:#ffffff;">
                <img src="${logoUrl}" alt="iRam" width="120" style="display:block;border:0;outline:none;text-decoration:none;width:120px;height:auto;">
              </td>
            </tr>
            <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.green};">&nbsp;</td></tr>

            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">Choose a new password</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">The link below works for ${input.expiryMinutes} minutes</p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0;">Somebody asked to reset the password on your <strong>iRam Route Planner</strong> account. Tap the button to choose a new one.</p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:26px 32px 6px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="background:${BRAND.green};border-radius:8px;">
                      <a href="${url}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Choose a new password</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:12px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.grey};">
                or paste this into your browser:<br>
                <a href="${url}" style="color:${BRAND.greenDark};text-decoration:none;word-break:break-all;">${url}</a>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${BRAND.green};">
                  <tr>
                    <td style="padding:2px 0 2px 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.dark};">
                      If this was not you, you can ignore this email: nothing changes until somebody opens the link and sets a new password. The link stops working once it has been used.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px 26px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0;">Regards,<br><strong>The iRam Team</strong></p>
              </td>
            </tr>

          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:16px 12px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${BRAND.grey};">
                iRam Route Planner &middot; Powered by OuterJoin
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${input.name},`,
    ``,
    `Somebody asked to reset the password on your iRam Route Planner account.`,
    `Open this link to choose a new one. It works for ${input.expiryMinutes} minutes:`,
    ``,
    input.resetUrl,
    ``,
    `If this was not you, you can ignore this email. Nothing changes until somebody`,
    `opens the link and sets a new password, and the link stops working once used.`,
    ``,
    `Regards,`,
    `The iRam Team`,
  ].join("\n");

  return { subject: "Reset your iRam Route Planner password", html, text };
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput
): Promise<WelcomeEmailResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { sent: false, configured: false, reason: "No RESEND_API_KEY configured." };
  }
  const { subject, html, text } = buildPasswordResetEmail(input);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "iRam <onboarding@resend.dev>",
        to: input.email,
        // The From address belongs to whichever domain is verified with the ESP,
        // which is not necessarily a mailbox anyone reads. Without this a rep who
        // hits Reply is writing into the void.
        ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Resend API error:", res.status, errData);
      const detail = errData?.message || errData?.error || "Unknown error";
      return { sent: false, configured: true, reason: `Email failed (${res.status}): ${detail}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("Resend request failed:", err);
    return { sent: false, configured: true, reason: `Email request failed: ${String(err)}` };
  }
}

export async function sendWelcomeEmail(input: WelcomeEmailInput): Promise<WelcomeEmailResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { sent: false, configured: false, reason: "No RESEND_API_KEY configured. Share the credentials manually." };
  }

  const { subject, html, text } = buildWelcomeEmail(input);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "iRam <onboarding@resend.dev>",
        to: input.email,
        ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Resend API error:", res.status, errData);
      const detail = errData?.message || errData?.error || "Unknown error";
      return { sent: false, configured: true, reason: `Email failed (${res.status}): ${detail}` };
    }

    return { sent: true };
  } catch (err) {
    console.error("Resend request failed:", err);
    return { sent: false, configured: true, reason: `Email request failed: ${String(err)}` };
  }
}
