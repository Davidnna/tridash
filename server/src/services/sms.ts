export type SmsDelivery = {
    sent: boolean;
    status: 'accepted' | 'not_configured' | 'invalid_number' | 'failed';
    message?: string;
};

function normalizeE164(phone: string): string | null {
    const value = String(phone || '').trim().replace(/[\s()-]/g, '');
    if (/^\+[1-9]\d{7,14}$/.test(value)) return value;
    const digits = value.replace(/\D/g, '');
    if (/^0\d{9,10}$/.test(digits)) return `+234${digits.slice(1)}`;
    if (/^234\d{9,10}$/.test(digits)) return `+${digits}`;
    return null;
}

export async function sendSms(phone: string, message: string): Promise<SmsDelivery> {
    const to = normalizeE164(phone);
    if (!to) return { sent: false, status: 'invalid_number', message: 'The destination phone number is not in a supported international format.' };

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !fromNumber) {
        return { sent: false, status: 'not_configured', message: 'SMS provider credentials are not configured.' };
    }

    try {
        const body = new URLSearchParams({ To: to, From: fromNumber, Body: message.slice(0, 1500) });
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });
        if (!response.ok) {
            const providerResponse = await response.json().catch(() => ({})) as { message?: string };
            console.error('SMS provider rejected delivery:', response.status, providerResponse.message || 'No provider message');
            return { sent: false, status: 'failed', message: 'The SMS provider could not accept the message.' };
        }
        return { sent: true, status: 'accepted', message: 'SMS request was accepted by the provider.' };
    } catch (error) {
        console.error('SMS delivery error:', error);
        return { sent: false, status: 'failed', message: 'The SMS provider could not be reached.' };
    }
}
