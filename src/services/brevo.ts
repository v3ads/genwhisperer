import axios from "axios";

const BREVO_API = "https://api.brevo.com/v3";

function getHeaders() {
  return {
    "api-key": process.env.BREVO_API_KEY!,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function getSender() {
  return {
    name: process.env.BREVO_SENDER_NAME ?? "Geny",
    email: process.env.BREVO_SENDER_EMAIL ?? "support@genwhisperer.com",
  };
}

interface SendEmailOptions {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  await axios.post(
    `${BREVO_API}/smtp/email`,
    {
      sender: getSender(),
      to: [{ email: opts.to, name: opts.toName ?? opts.to }],
      subject: opts.subject,
      htmlContent: opts.htmlContent,
      textContent: opts.textContent,
      trackClicks: false,
      trackOpens: false,
    },
    { headers: getHeaders() }
  );
}

// ─── Magic-link email ─────────────────────────────────────────────────────────
export async function sendMagicLink(email: string, link: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Your GenWhisperer sign-in link",
    htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 16px; padding: 40px;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #fff; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">GenWhisperer</h1>
      <p style="color: #888; font-size: 13px; margin: 6px 0 0;">AI Prompt Assistant</p>
    </div>
    <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">Click the button below to sign in. This link expires in <strong style="color: #fff;">15 minutes</strong> and can only be used once.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${link}" style="display: inline-block; background: #fff; color: #000; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: 8px; letter-spacing: -0.2px;">Sign in to GenWhisperer</a>
    </div>
    <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 24px 0 0;">If you didn't request this, you can safely ignore this email. This link will expire automatically.</p>
    <hr style="border: none; border-top: 1px solid #222; margin: 32px 0;">
    <p style="color: #444; font-size: 12px; text-align: center; margin: 0;">© ${new Date().getFullYear()} GenWhisperer · <a href="mailto:support@genwhisperer.com" style="color: #666; text-decoration: none;">support@genwhisperer.com</a></p>
  </div>
</body>
</html>`,
    textContent: `Sign in to GenWhisperer\n\nClick this link to sign in (expires in 15 minutes):\n${link}\n\nIf you didn't request this, ignore this email.`,
  });
}

// ─── Owner notification emails ────────────────────────────────────────────────
export async function notifyOwner(subject: string, body: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL ?? "vipaymanshalaby@gmail.com";
  await sendEmail({
    to: adminEmail,
    subject: `[GenWhisperer] ${subject}`,
    htmlContent: `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 16px; padding: 40px;">
    <h2 style="color: #fff; font-size: 18px; margin: 0 0 16px;">${subject}</h2>
    <div style="color: #ccc; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${body}</div>
    <hr style="border: none; border-top: 1px solid #222; margin: 24px 0;">
    <p style="color: #444; font-size: 12px; margin: 0;">GenWhisperer System · ${new Date().toISOString()}</p>
  </div>
</body>
</html>`,
    textContent: `${subject}\n\n${body}`,
  });
}

export async function notifyNewSignup(email: string): Promise<void> {
  await notifyOwner("New sign-up", `A new user just signed up:\n\nEmail: ${email}\nTime: ${new Date().toISOString()}`);
}

export async function notifyTrialExhausted(email: string, messageCount: number): Promise<void> {
  await notifyOwner(
    "Trial exhausted",
    `A user has used all their free trial messages:\n\nEmail: ${email}\nMessages used: ${messageCount}\nTime: ${new Date().toISOString()}`
  );
}
