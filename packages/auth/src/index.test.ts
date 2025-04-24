import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { sign, verify, generateToken, authMiddleware, verifyWebSocketToken, JWTPayload, AuthConfig } from './index.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const DEV_SECRET = 'test_secret';
const payload: JWTPayload = { userId: 'user123', role: 'dev' };

// Mock fs module for testing with RS256 keys
vi.mock('fs', () => ({
    readFileSync: vi.fn((path) => {
        if (path.includes('private.key')) {
            return 'mock-private-key';
        }
        if (path.includes('public.key')) {
            return 'mock-public-key';
        }
        throw new Error(`Unexpected path: ${path}`);
    })
}));

// Mock jwt module to bypass actual cryptographic operations
vi.mock('jsonwebtoken', () => ({
    default: {
        sign: vi.fn().mockReturnValue('mock.jwt.token'),
        verify: vi.fn().mockImplementation((token, key, options) => {
            if (token === 'invalid-token') throw new Error('Invalid token');
            if (token === 'expired-token') throw new Error('Token expired');
            return { ...payload, iat: Math.floor(Date.now() / 1000) };
        })
    }
}));

describe('auth sign/verify', () => {
    beforeAll(() => {
        // Mock process.env for required env variables
        process.env.DEV_SECRET = DEV_SECRET;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('signs a payload and returns a JWT with HS256', () => {
        const token = sign(payload);
        expect(jwt.sign).toHaveBeenCalledWith(
            payload,
            DEV_SECRET,
            expect.objectContaining({ algorithm: 'HS256' })
        );
    });

    it('verifies a valid token and returns the payload with HS256', () => {
        const decoded = verify('valid-token');
        expect(jwt.verify).toHaveBeenCalledWith(
            'valid-token',
            DEV_SECRET,
            expect.objectContaining({ algorithms: ['HS256'] })
        );
        expect(decoded.userId).toBe(payload.userId);
    });

    it('signs a payload with RS256 when configured', () => {
        // Configure RS256 with paths
        process.env.JWT_ALGORITHM = 'RS256';
        process.env.JWT_PRIVATE_KEY_PATH = '/path/to/private.key';
        process.env.JWT_PUBLIC_KEY_PATH = '/path/to/public.key';

        const config: AuthConfig = {
            algorithm: 'RS256',
            privateKeyPath: '/path/to/private.key',
            publicKeyPath: '/path/to/public.key'
        };

        const token = sign(payload, config);

        expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('private.key'));
        expect(jwt.sign).toHaveBeenCalledWith(
            payload,
            'mock-private-key',
            expect.objectContaining({ algorithm: 'RS256' })
        );
    });

    it('verifies a token with RS256 when configured', () => {
        const config: AuthConfig = {
            algorithm: 'RS256',
            privateKeyPath: '/path/to/private.key',
            publicKeyPath: '/path/to/public.key'
        };

        const decoded = verify('valid-token', config);

        expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('public.key'));
        expect(jwt.verify).toHaveBeenCalledWith(
            'valid-token',
            'mock-public-key',
            expect.objectContaining({ algorithms: ['RS256'] })
        );
        expect(decoded.userId).toBe(payload.userId);
    });

    it('generates a token with the user ID and additional data', () => {
        const additionalData = { permissions: ['read', 'write'] };
        const token = generateToken('user123', additionalData);

        expect(jwt.sign).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user123',
                permissions: ['read', 'write']
            }),
            expect.anything(),
            expect.anything()
        );
    });

    it('verifies WebSocket token and returns payload or null', () => {
        // Valid token
        const validResult = verifyWebSocketToken('valid-token');
        expect(validResult).toEqual(expect.objectContaining({ userId: 'user123' }));

        // Invalid token
        const invalidResult = verifyWebSocketToken('invalid-token');
        expect(invalidResult).toBeNull();
    });

    it('provides middleware for API authentication', () => {
        const middleware = authMiddleware();

        // Mock Express objects
        const req: any = {
            headers: { authorization: 'Bearer valid-token' }
        };
        const res: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        const next = vi.fn();

        // Execute middleware
        middleware(req, res, next);

        // Assert user is attached to request
        expect(req.user).toEqual(expect.objectContaining({ userId: 'user123' }));
        expect(next).toHaveBeenCalled();

        // Test with invalid auth header
        const reqNoToken: any = { headers: {} };
        middleware(reqNoToken, res, next);
        expect(res.status).toHaveBeenCalledWith(401);

        // Test with invalid token
        const reqInvalidToken: any = { headers: { authorization: 'Bearer invalid-token' } };
        middleware(reqInvalidToken, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });
}); 