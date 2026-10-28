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

## Planned implementation
1. Add account identity fields for Google subject and password hash, plus expiring one-time email verification and password-reset token hashes.
2. Implement server-owned registration, email/password login, Google token exchange, verification, resend-verification, forgot-password, reset-password, current-session, and logout endpoints.
3. Add branded email templates and a transactional email adapter (Resend) with a configurable verified sender.
4. Replace frontend Firebase Auth calls with the Tridash auth API and Google Identity Services.
5. Add a compatibility/migration path for existing Firebase-linked users so they can safely establish a Tridash password or link Google sign-in without losing their existing account and data.
6. Remove Firebase client/admin dependencies only after the new login and migration path are verified in staging/production.
7. Test passenger, driver, admin, refresh/session persistence, email verification/reset, Google sign-in, and existing data before rollout.

## Required Render configuration before enabling new auth
- `GOOGLE_CLIENT_ID` (OAuth Web client ID; also expose the same public ID to the frontend as `VITE_GOOGLE_CLIENT_ID`)
- `RESEND_API_KEY` (backend secret)
- `AUTH_EMAIL_FROM` (sender address on a domain verified with Resend)
- `APP_BASE_URL=https://app-tridash.onrender.com`
- `PUBLIC_BASE_URL=https://tridash.onrender.com`

Do not remove existing Firebase configuration until migration testing confirms existing users can sign in through the replacement.
