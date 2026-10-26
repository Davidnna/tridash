# Tridash payout-account fixes

## Changes

- Replaced the unsupported/general `type=nip_bank` bank-list filter with Paystack's Nigerian NGN bank-list request.
- Added offset pagination (up to 20 pages), code-based deduplication, alphabetical sorting, and a six-hour in-memory cache.
- Added a stale-cache fallback if Paystack temporarily fails after a bank list has already been loaded.
- Added visible bank loading/error/retry states and a searchable bank picker.
- Improved account-name verification feedback and disabled bank/account editing while verification or saving is in progress.
- Re-resolves the account on the server when saving, and rejects a stale or mismatched account name.
- Uses Paystack's documented `bank_code` field when creating/updating a subaccount.
- Updates an existing subaccount when bank details change, avoiding the routine creation of orphaned subaccounts.
- Added a masked saved-account summary and payout-form styling.

## Verification performed

- Server TypeScript check passed.
- Frontend TypeScript check passed with existing unused-local/unused-parameter diagnostics disabled. The source already contains unrelated unused variables/imports.
- A full Vite production build could not be completed in this environment because the supplied dependency folder is missing Rollup's Linux native optional package and package installation could not complete without registry access.
- No live Paystack API call was performed. Validate the list, account resolution, subaccount create/update, and payment split in Paystack Test Mode before production use.

## Security

This clean source archive intentionally excludes `.env` files, `.git`, `node_modules`, generated `dist` folders, and local AppDeploy authentication files. Configure environment variables separately using `server/.env.example` as a template.
