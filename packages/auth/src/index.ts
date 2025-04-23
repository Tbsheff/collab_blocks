import jwt from 'jsonwebtoken';

/**
 * Sign a payload and return a JWT string
 * @param payload - object to sign
 * @returns JWT string
 */
export function sign(payload: any): string {
    const secret = process.env.DEV_SECRET;
    if (!secret) throw new Error('DEV_SECRET not set');
    return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

/**
 * Verify a JWT and return the decoded payload
 * @param token - JWT string
 * @returns Decoded payload
 */
export function verify(token: string): any {
    const secret = process.env.DEV_SECRET;
    if (!secret) throw new Error('DEV_SECRET not set');
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
} 