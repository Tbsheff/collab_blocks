import jwt, { SignOptions, VerifyOptions, Algorithm } from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

// Types for JWT payloads
export interface JWTPayload {
    userId: string;
    role?: string;
    exp?: number;
    iat?: number;
    [key: string]: any;
}

export interface AuthConfig {
    algorithm: 'HS256' | 'RS256';
    secret?: string;
    privateKeyPath?: string;
    publicKeyPath?: string;
    expiresIn?: string | number;
}

// Default config using environment variables
const defaultConfig: AuthConfig = {
    algorithm: (process.env.JWT_ALGORITHM as 'HS256' | 'RS256') || 'HS256',
    secret: process.env.JWT_SECRET || process.env.DEV_SECRET,
    privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH,
    publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
};

/**
 * Get the secret key or read the private/public key files based on the algorithm
 * @param config - Auth configuration
 * @param forSigning - Whether the key is for signing (true) or verification (false)
 * @returns The key to use for signing or verification
 */
function getKey(config: AuthConfig, forSigning: boolean): string | Buffer {
    const { algorithm, secret, privateKeyPath, publicKeyPath } = config;

    if (algorithm === 'HS256') {
        if (!secret) throw new Error('JWT_SECRET not set for HS256 algorithm');
        return secret;
    } else if (algorithm === 'RS256') {
        if (forSigning) {
            if (!privateKeyPath) throw new Error('JWT_PRIVATE_KEY_PATH not set for RS256 algorithm');
            return fs.readFileSync(path.resolve(privateKeyPath));
        } else {
            if (!publicKeyPath) throw new Error('JWT_PUBLIC_KEY_PATH not set for RS256 algorithm');
            return fs.readFileSync(path.resolve(publicKeyPath));
        }
    }

    throw new Error(`Unsupported algorithm: ${algorithm}`);
}

/**
 * Sign a payload and return a JWT string
 * @param payload - object to sign
 * @param configOverride - optional config override
 * @returns JWT string
 */
export function sign(payload: JWTPayload, configOverride?: Partial<AuthConfig>): string {
    const config = { ...defaultConfig, ...configOverride };
    const key = getKey(config, true);

    const options: SignOptions = {
        algorithm: config.algorithm as Algorithm,
    };

    if (config.expiresIn !== undefined) {
        options.expiresIn = config.expiresIn as any;
    }

    return jwt.sign(payload, key, options);
}

/**
 * Verify a JWT and return the decoded payload
 * @param token - JWT string
 * @param configOverride - optional config override
 * @returns Decoded payload
 */
export function verify(token: string, configOverride?: Partial<AuthConfig>): JWTPayload {
    const config = { ...defaultConfig, ...configOverride };
    const key = getKey(config, false);

    const options: VerifyOptions = {
        algorithms: [config.algorithm as Algorithm]
    };

    return jwt.verify(token, key, options) as JWTPayload;
}

/**
 * Generate a new token for a user
 * @param userId - User ID to include in the token
 * @param additionalData - Additional data to include in the payload
 * @param configOverride - optional config override
 * @returns JWT string
 */
export function generateToken(
    userId: string,
    additionalData: Record<string, any> = {},
    configOverride?: Partial<AuthConfig>
): string {
    const payload = {
        userId,
        ...additionalData,
    };

    return sign(payload, configOverride);
}

/**
 * Express middleware for authenticating requests
 * @param config - optional config override
 * @returns Express middleware function
 */
export function authMiddleware(configOverride?: Partial<AuthConfig>) {
    return (req: any, res: any, next: any) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader) {
                return res.status(401).json({ error: 'No authorization header provided' });
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const decoded = verify(token, configOverride);
            req.user = decoded;
            next();
        } catch (error) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    };
}

/**
 * Utility function to verify a token from WebSocket query parameters
 * @param token - JWT string
 * @param configOverride - optional config override
 * @returns Decoded payload or null if invalid
 */
export function verifyWebSocketToken(token: string, configOverride?: Partial<AuthConfig>): JWTPayload | null {
    try {
        return verify(token, configOverride);
    } catch (error) {
        return null;
    }
} 