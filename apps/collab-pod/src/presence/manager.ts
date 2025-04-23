import { PresenceState } from '@collabblocks/protocol';
import { LRUCache } from 'lru-cache';
import type Redis from 'ioredis';

interface UserPresence {
    userId: string;
    state: PresenceState;
    lastActive: number;
}

/**
 * Manages presence state for rooms, with optional Redis Streams support
 */
export class PresenceManager {
    // Room ID -> Map of User ID -> Presence State
    private rooms = new Map<string, LRUCache<string, UserPresence>>();
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
    private getRoom(roomId: string): LRUCache<string, UserPresence> {
        let room = this.rooms.get(roomId);

        if (!room) {
            room = new LRUCache<string, UserPresence>({
                max: 1000, // Maximum 1000 users per room
                ttl: this.ttl,
            });

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
        const room = this.getRoom(roomId);
        const result: PresenceState[] = [];

        for (const [, presence] of room.entries()) {
            result.push({
                ...presence.state,
                meta: {
                    ...presence.state.meta,
                    userId: presence.userId,
                },
            });
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
        }
    }

    /**
     * Cleanup expired presence
     * Called periodically to remove stale entries
     */
    public cleanup(): void {
        // LRU handles TTL automatically
        // Just check if rooms are empty and remove them
        for (const [roomId, room] of this.rooms.entries()) {
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