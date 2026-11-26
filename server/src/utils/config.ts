import prisma from './database';

async function readSetting(key: string): Promise<unknown> {
    try {
        const setting = await prisma.platformSetting.findUnique({ where: { key } });
        return setting?.value;
    } catch {
        // Keep existing deployments functional until the additive settings migration is applied.
        return undefined;
    }
}

export async function getCommissionPercent(): Promise<number> {
    const stored = await readSetting('platform_commission_percent');
    const candidate = typeof stored === 'number' || typeof stored === 'string'
        ? Number(stored)
        : Number(process.env.PLATFORM_COMMISSION_PERCENT);
    return Number.isFinite(candidate) && candidate >= 0 && candidate <= 50 ? candidate : 15;
}

export async function getServiceStatus(): Promise<'active' | 'paused'> {
    const stored = await readSetting('service_status');
    return String(stored || 'active').toLowerCase() === 'paused' ? 'paused' : 'active';
}
