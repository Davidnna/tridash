import crypto from 'crypto';

const API_URI = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, '');
const DOMAIN = process.env.NYLAS_DOMAIN || 'tridash.nylas.email';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character] as string));
}

export type AuthEmailKind = 'verify' | 'reset' | 'notification';

export async function sendAuthEmail(input: {
  to: string;
  name?: string;
  kind: AuthEmailKind;
  token: string;
}) {
  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) throw new Error('Nylas email is not configured');

  const appUrl = (process.env.APP_BASE_URL || 'https://app-tridash.onrender.com').replace(/\/$/, '');
  const recipientName = input.name?.trim() || 'there';
  const isVerify = input.kind === 'verify';
  const isReset = input.kind === 'reset';
  const url = isVerify
    ? appUrl + '/verify-email?token=' + encodeURIComponent(input.token)
    : appUrl + '/reset-password?token=' + encodeURIComponent(input.token);
  const title = isVerify ? 'Verify your Tridash email' : isReset ? 'Reset your Tridash password' : 'Tridash notification';
  const action = isVerify ? 'Verify email address' : 'Reset password';
  const description = isVerify
    ? 'Confirm your email address to finish setting up your Tridash account.'
    : 'We received a request to reset the password for your Tridash account. If you did not request this, you can safely ignore this email.';
  const sender = isVerify
    ? (process.env.AUTH_EMAIL_FROM || 'verify@tridash.nylas.email')
    : isReset
      ? (process.env.SECURITY_EMAIL_FROM || 'security@tridash.nylas.email')
      : (process.env.NOTIFICATIONS_EMAIL_FROM || 'notifications@tridash.nylas.email');
  const subject = isVerify ? 'Verify your Tridash account' : 'Reset your Tridash password';
  const body = `<div style="background:#f5f7f6;padding:32px 12px;font-family:Arial,sans-serif;color:#14231a"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e0e8e2"><div style="font-weight:800;letter-spacing:.5px;color:#17633a;font-size:22px">TRIDASH</div><h1 style="font-size:24px;margin:28px 0 12px">${title}</h1><p>Hello ${escapeHtml(recipientName)},</p><p style="line-height:1.6">${description}</p><p style="margin:28px 0"><a href="${url}" style="background:#17633a;color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:700">${action}</a></p><p style="font-size:13px;color:#536259;line-height:1.6">If the button does not work, copy this link into your browser:<br><a href="${url}" style="color:#17633a;overflow-wrap:anywhere">${url}</a></p><p style="font-size:13px;color:#536259">For your security, this link expires in 60 minutes.</p><hr style="border:0;border-top:1px solid #e5ebe6;margin:28px 0"><p style="font-size:12px;color:#68756d">Tridash · Safer, simpler rides.</p></div></div>`;
  const response = await fetch(`${API_URI}/v3/domains/${encodeURIComponent(DOMAIN)}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: [{ email: input.to, name: recipientName }],
      from: { name: 'Tridash', email: sender },
      subject,
      body,
      reply_to: process.env.AUTH_EMAIL_REPLY_TO ? [{ email: process.env.AUTH_EMAIL_REPLY_TO }] : undefined,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Nylas transactional email failed:', response.status, detail.slice(0, 500));
    throw new Error('We could not send the email. Please try again later.');
  }
}

export function makeOneTimeToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function tokenExpiresAt() {
  return new Date(Date.now() + 60 * 60 * 1000);
}
