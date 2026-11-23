import crypto from 'crypto';

export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function digestHex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value)
    );
    return bytesToHex(new Uint8Array(digest));
}

export function makeSessionToken(): string {
    return crypto.randomUUID() + '.' + crypto.randomUUID();
}

export function getCookie(req: any, name: string): string | null {
    const header = req.headers?.cookie || req.headers?.Cookie || '';
    const match = String(header)
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(name + '='));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// SameSite=None is required because the frontend and backend are deployed on
// different origins (tridash.onrender.com and tridash-api.onrender.com), and
// onrender.com is a public suffix, so the browser treats them as cross-site.
// Lax cookies are never attached to cross-site fetch() calls.
export function setCookieHeader(token: string, maxAge: number = 2592000): string {
    return `tridash_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export function clearCookieHeader(): string {
    return 'tridash_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0';
}
