/**
 * Write the welcome email to an HTML file so it can be opened in a browser.
 *
 * The alternative is sending real mail to a real person to see a colour change,
 * and /api/users/send-welcome resets the recipient's password every time.
 *
 *   npx tsx scripts/preview-welcome-email.ts [outputPath] [--rep]
 *
 * `--rep` renders the version sent to reps, which asks them to set their home
 * address rather than describing an app they have no other access to.
 */
import { writeFileSync } from "fs";
import { buildWelcomeEmail } from "../lib/welcomeEmail";

const isRep = process.argv.includes("--rep");
const out =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ||
  (isRep ? "welcome-email-rep-preview.html" : "welcome-email-preview.html");

const { subject, html, text } = buildWelcomeEmail(
  isRep
    ? {
        name: "Thabo Nkosi",
        email: "thabo.nkosi@iram.co.za",
        password: "iRam-K7fQ-mX3T",
        forcePasswordChange: true,
        audience: "rep",
      }
    : {
        name: "Grant Berridge",
        email: "grant@iram.co.za",
        password: "iRamlaf75v!",
        forcePasswordChange: true,
      }
);

writeFileSync(out, html, "utf8");

console.log(`Subject: ${subject}`);
console.log(`HTML:    ${out} (${html.length} bytes)`);
console.log("\n--- plain text alternative ---\n");
console.log(text);
