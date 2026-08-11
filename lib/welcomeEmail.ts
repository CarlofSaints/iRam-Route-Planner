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
    <title>Welcome to iRam Route Planner</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.greenLighter};">
    <!-- preview text, hidden in the body but shown in the inbox list -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your iRam Route Planner sign-in details are inside.</div>
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
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">Welcome to the Route Planner</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">Your account is ready</p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0;">An account has been created for you on <strong>iRam Route Planner</strong> — where call cycles, rep journeys and store allocations are planned. Here are your sign-in details.</p>
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
                      <a href="${appUrl}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Sign in to iRam Route Planner</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:12px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.grey};">
                or paste this into your browser:<br>
                <a href="${appUrl}" style="color:${BRAND.greenDark};text-decoration:none;">${appUrl}</a>
              </td>
            </tr>

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
    `An account has been created for you on iRam Route Planner.`,
    ``,
    `Sign-in URL: ${appUrl}`,
    `Email:       ${input.email}`,
    `Password:    ${input.password}`,
    ``,
    passwordNote,
    `Keep this email private until you have — anyone with the password above can sign in as you.`,
    ``,
    `Regards,`,
    `The iRam Team`,
    ``,
    `You're receiving this because an administrator created an account for you.`,
    `If that wasn't expected, please tell your administrator and don't sign in.`,
  ].join("\n");

  return { subject: "Welcome to iRam Route Planner", html, text };
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
