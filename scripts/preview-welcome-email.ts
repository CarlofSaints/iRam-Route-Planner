/**
 * Write the welcome email to an HTML file so it can be opened in a browser.
 *
 * The alternative is sending real mail to a real person to see a colour change,
 * and /api/users/send-welcome resets the recipient's password every time.
 *
 *   npx tsx scripts/preview-welcome-email.ts [outputPath]
 */
import { writeFileSync } from "fs";
import { buildWelcomeEmail } from "../lib/welcomeEmail";

const out = process.argv[2] || "welcome-email-preview.html";

const { subject, html, text } = buildWelcomeEmail({
  name: "Grant Berridge",
  email: "grant@iram.co.za",
  password: "iRamlaf75v!",
  forcePasswordChange: true,
});

writeFileSync(out, html, "utf8");

console.log(`Subject: ${subject}`);
console.log(`HTML:    ${out} (${html.length} bytes)`);
console.log("\n--- plain text alternative ---\n");
console.log(text);
