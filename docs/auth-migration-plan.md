# Tridash-owned authentication migration

## Goal
Replace Firebase Authentication with Tridash-managed email/password authentication, Google sign-in, and branded transactional emails while retaining Neon PostgreSQL, Prisma, the existing user/profile/ride/payment records, and the existing server-managed session cookie.

## Non-negotiable safeguards
- Do not deploy this migration until the new flows build and are tested.
- Do not delete or reset existing users, sessions, rides, drivers, or payments.
- Preserve role assignment, super-admin rules, suspended-account checks, driver-offline-on-login/logout behavior, and email-verification requirements.
- Verify Google ID tokens on the server; never trust a user ID or email supplied by the browser alone.
- Use secure, HttpOnly, SameSite cookies and rate-limit password/reset/verification endpoints.
- Keep secrets in Render environment variables; never commit secrets.
- Keep Firebase compatibility until existing users have a tested migration path.

## Planned implementation
1. Add account identity fields for Google subject and password hash, plus expiring one-time email verification and password-reset token hashes.
2. Implement server-owned registration, email/password login, Google token exchange, verification, resend-verification, forgot-password, reset-password, current-session, and logout endpoints.
3. Add branded email templates and a Nylas Transactional Send adapter with purpose-specific sender identities.
4. Replace frontend Firebase Auth calls with the Tridash auth API and Google Identity Services.
5. Add a compatibility/migration path for existing Firebase-linked users so they can safely establish a Tridash password or link Google sign-in without losing their existing account and data.
6. Remove Firebase client/admin dependencies only after the new login and migration path are verified in staging/production.
7. Test passenger, driver, admin, refresh/session persistence, email verification/reset, Google sign-in, and existing data before rollout.

## Render environment variables

### Backend: `tridash-api`
- `GOOGLE_CLIENT_ID` — Google OAuth Web client ID.
- `NYLAS_API_KEY` — secret API key; backend only.
- `NYLAS_API_URI=https://api.us.nylas.com`
- `NYLAS_DOMAIN=tridash.nylas.email`
- `AUTH_EMAIL_FROM=verify@tridash.nylas.email`
- `SECURITY_EMAIL_FROM=security@tridash.nylas.email`
- `NOTIFICATIONS_EMAIL_FROM=notifications@tridash.nylas.email`
- `SUPPORT_EMAIL_FROM=support@tridash.nylas.email`
- `APP_BASE_URL=https://app-tridash.onrender.com`
- `PUBLIC_BASE_URL=https://tridash.onrender.com`

### Frontend: `app-tridash`
- `VITE_GOOGLE_CLIENT_ID` — same public Google OAuth Web client ID.

Nylas Transactional Send requires a verified sending domain. If no mailbox is connected for incoming replies, set a monitored `reply_to` address in messages where replies should be handled.

Do not remove existing Firebase configuration until migration testing confirms existing users can sign in through the replacement.
