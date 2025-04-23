import { LRUCache } from 'lru-cache';
import type Redis from 'ioredis';

// Define presence state interface for local use
interface PresenceState {
    /**
     * User's cursor position (normalized 0-1 coordinates)
     */
    cursor?: { x: number; y: number };

    /**
     * URL to user's avatar image
     */
    avatar?: string;

    /**
     * User's status (e.g., "idle", "editing", "commenting")
     */
    status?: string;

    /**
     * Additional user metadata (limit <2KB)
     */
    meta?: Record<string, unknown>;
}

/**
 * Room member
 */
interface RoomMember {
    userId: string;
    state: PresenceState;
    lastActive: number;
}

/**
 * Manages presence state for rooms, with optional Redis Streams support
 */
export class PresenceManager {
    // Room ID -> Map of user IDs to member data
    private rooms: Map<string, Map<string, RoomMember>> = new Map();

    // LRU cache for rooms - expires after 1 hour of inactivity
    private roomCache = new LRUCache<string, Map<string, RoomMember>>({
        max: 1000,
        ttl: 1000 * 60 * 60, // 1 hour
        allowStale: false,
    });

    private redis?: Redis;
    private streamPrefix = 'presence-';
    private ttl: number;

    constructor(redisClient?: Redis, ttl: number = 1000 * 60 * 2) {
        this.redis = redisClient;
        this.ttl = ttl;
    }

    /**
     * Get or create LRU cache for a room
     */
    private getRoom(roomId: string): Map<string, RoomMember> {
        let room = this.rooms.get(roomId);

        if (!room) {
            room = new Map();
            this.rooms.set(roomId, room);
        }

        return room;
    }

    /**
     * Apply presence update for a user
     */
    public async applyDiff(roomId: string, userId: string, diff: Partial<PresenceState>): Promise<void> {
        const room = this.getRoom(roomId);
        const existing = room.get(userId);

        const newState: PresenceState = existing
            ? { ...existing.state, ...diff }
            : { ...diff };

        room.set(userId, {
            userId,
            state: newState,
            lastActive: Date.now(),
        });

        // Publish diff to Redis Stream if enabled
        if (this.redis) {
            await this.redis.xadd(
                this.streamPrefix + roomId,
                '*',
                'userId', userId,
                'diff', JSON.stringify(diff),
                'ts', Date.now().toString()
            );
        }
    }

    /**
     * Get full presence state for a room
     */
    public getFullState(roomId: string): PresenceState[] {
        const room = this.rooms.get(roomId);
        const result: PresenceState[] = [];

        if (room) {
            for (const member of room.values()) {
                result.push(member.state);
            }
        }

        return result;
    }

    /**
     * Remove a user from a room
     */
    public removeUser(roomId: string, userId: string): void {
        const room = this.rooms.get(roomId);
        if (room) {
            room.delete(userId);
            if (room.size === 0) {
                this.rooms.delete(roomId);
            }
        }
    }

    /**
     * Cleanup expired presence
     * Called periodically to remove stale entries
     */
    public cleanup(): void {
        const now = Date.now();
        const timeout = 60 * 1000; // 60 seconds

        for (const [roomId, room] of this.rooms.entries()) {
            let hasChanges = false;
            for (const [userId, member] of room.entries()) {
                if (now - member.lastActive > timeout) {
                    room.delete(userId);
                    hasChanges = true;
                }
            }

            if (room.size === 0) {
                this.rooms.delete(roomId);
            }
        }
    }

    // Read presence diffs from Redis Stream (for cross-pod sync)
    public async readDiffs(roomId: string, lastId: string = '$'): Promise<any[]> {
        if (!this.redis) return [];
        const stream = this.streamPrefix + roomId;
        const res = await this.redis.xread('BLOCK', 0, 'STREAMS', stream, lastId);
        return res || [];
    }
} 