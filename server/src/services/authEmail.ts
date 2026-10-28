import crypto from 'crypto';

const from = () => process.env.AUTH_FROM_EMAIL || 'Tridash <no-reply@tridash.ng>';
const appBaseUrl = () => (process.env.AUTH_APP_URL || process.env.FRONTEND_URL || 'https://app-tridash.onrender.com').replace(/\/$/, '');

export function createAuthToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
}

export function hashAuthToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email delivery is not configured. Set RESEND_API_KEY and AUTH_FROM_EMAIL.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from(), to: [to], subject, html }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Transactional email provider rejected message:', response.status, detail.slice(0, 300));
    throw new Error('We could not send the email right now. Please try again later.');
  }
}

function layout(title: string, intro: string, actionLabel: string, url: string, expiry: string) {
  const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<div style="margin:0;background:#f5f4fa;padding:32px 12px;font-family:Arial,sans-serif;color:#191528"><div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e8e5f1;border-radius:18px;overflow:hidden"><div style="background:#2a1454;padding:24px 30px;color:#fff"><div style="font-size:24px;font-weight:800;letter-spacing:-.5px">Tridash</div><div style="font-size:12px;margin-top:5px;color:#d8cafa">Safer rides. Clearer journeys.</div></div><div style="padding:30px"><h1 style="font-size:23px;margin:0 0 14px">${title}</h1><p style="font-size:15px;line-height:1.7;color:#4b4659">${intro}</p><p style="margin:26px 0"><a href="${safeUrl}" style="display:inline-block;background:#8750f7;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px">${actionLabel}</a></p><p style="font-size:13px;line-height:1.6;color:#777184">This link expires ${expiry}. If you did not request this, you can ignore this message.</p><p style="font-size:12px;color:#928da0;word-break:break-all">If the button does not work, copy this link:<br>${safeUrl}</p></div></div><p style="text-align:center;font-size:12px;color:#8b8598;margin:18px auto 0">© ${new Date().getFullYear()} Tridash</p></div>`;
}

export async function sendVerificationEmail(email: string, token: string) {
  const url = appBaseUrl() + '/?verify-email=' + encodeURIComponent(token);
  await sendEmail(email, 'Verify your Tridash email address', layout('Verify your email', 'Welcome to Tridash. Confirm that this email address belongs to you to activate your account.', 'Verify email address', url, 'in 24 hours'));
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const url = appBaseUrl() + '/?reset-password=' + encodeURIComponent(token);
  await sendEmail(email, 'Reset your Tridash password', layout('Reset your password', 'We received a request to reset the password for your Tridash account. Use the secure link below to choose a new password.', 'Reset password', url, 'in 1 hour'));
}
