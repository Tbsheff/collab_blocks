import { describe, it, expect, beforeAll } from 'vitest';
import { sign, verify } from './index.js';

const DEV_SECRET = 'test_secret';
const payload = { userId: 'user123', role: 'dev' };

// Mock process.env for DEV_SECRET
beforeAll(() => {
    process.env.DEV_SECRET = DEV_SECRET;
});

describe('auth sign/verify', () => {
    it('signs a payload and returns a JWT', () => {
        const token = sign(payload);
        expect(typeof token).toBe('string');
        expect(token.split('.').length).toBe(3); // JWT format
    });

    it('verifies a valid token and returns the payload', () => {
        const token = sign(payload);
        const decoded = verify(token);
        expect(decoded.userId).toBe(payload.userId);
        expect(decoded.role).toBe(payload.role);
    });

    it('throws on invalid or tampered token', () => {
        const token = sign(payload);
        // Tamper with the token
        const badToken = token.replace(/.$/, 'x');
        expect(() => verify(badToken)).toThrow();
    });
}); 