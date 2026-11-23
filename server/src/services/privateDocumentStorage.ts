import fs from 'fs/promises';
import path from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTED_PREFIX = Buffer.from('TDOC1');

function storageDirectory() {
    return path.resolve(process.env.DRIVER_DOCUMENT_STORAGE_DIR || path.join(process.cwd(), 'private-uploads', 'driver-verification'));
}

function encryptionKey() {
    const value = String(process.env.DRIVER_DOCUMENT_ENCRYPTION_KEY || '').trim();
    if (!value) {
        if (process.env.NODE_ENV === 'production') throw new Error('Secure document encryption is not configured. Set DRIVER_DOCUMENT_ENCRYPTION_KEY before accepting driver documents.');
        return null;
    }
    if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('DRIVER_DOCUMENT_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).');
    return Buffer.from(value, 'hex');
}

export async function writePrivateDocument(storageKey: string, contents: Buffer) {
    const dir = storageDirectory();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const key = encryptionKey();
    let stored = contents;
    if (key) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(contents), cipher.final()]);
        stored = Buffer.concat([ENCRYPTED_PREFIX, iv, cipher.getAuthTag(), ciphertext]);
    }
    const filePath = path.join(dir, storageKey);
    await fs.writeFile(filePath, stored, { flag: 'wx', mode: 0o600 });
    return filePath;
}

export async function readPrivateDocument(storageKey: string) {
    // Storage keys are generated UUIDs by the server; reject anything that could escape the private directory.
    if (!/^[0-9a-f-]{36}$/i.test(storageKey)) throw new Error('Invalid private document key.');
    const stored = await fs.readFile(path.join(storageDirectory(), storageKey));
    if (!stored.subarray(0, ENCRYPTED_PREFIX.length).equals(ENCRYPTED_PREFIX)) return stored;
    const key = encryptionKey();
    if (!key) throw new Error('The document encryption key is required to read this file.');
    const ivStart = ENCRYPTED_PREFIX.length;
    const iv = stored.subarray(ivStart, ivStart + 12);
    const tag = stored.subarray(ivStart + 12, ivStart + 28);
    const ciphertext = stored.subarray(ivStart + 28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function deletePrivateDocument(storageKey: string) {
    if (!/^[0-9a-f-]{36}$/i.test(storageKey)) return;
    await fs.unlink(path.join(storageDirectory(), storageKey)).catch(() => { });
}
