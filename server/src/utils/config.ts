// Platform commission kept by Tridash on split payments; the driver's share
// is routed to their Paystack subaccount at settlement. Configurable via
// environment variable without a redeploy.
export function getCommissionPercent(): number {
    const value = Number(process.env.PLATFORM_COMMISSION_PERCENT);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 15;
}
