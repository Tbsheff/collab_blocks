import { LRUCache } from 'lru-cache';
import type Redis from 'ioredis';
// Import types from the protocol package
import type { UserPresence, PresenceDiff } from '@collab-blocks/protocol';

/**
 * Room member - uses UserPresence from protocol
 */
interface RoomMember {
    // userId is now the key in the map, store the full UserPresence object
    presence: UserPresence;
    lastActive: number;
}

/**
 * Manages presence state for rooms, with optional Redis Streams support
 */
export class PresenceManager {
    // Room ID -> Map of user IDs to RoomMember
    private rooms: Map<string, Map<string, RoomMember>> = new Map();

    // LRU cache for rooms - expires after 1 hour of inactivity
    private roomCache = new LRUCache<string, Map<string, RoomMember>>({
        max: 1000,
        ttl: 1000 * 60 * 60, // 1 hour
        allowStale: false,
        // TODO: Add dispose method to potentially clean up Redis subscriptions?
    });

    private redis?: Redis;
    private streamPrefix = 'presence-';
    // TTL removed, cleanup likely handled by Edge DO
    // private ttl: number;

    constructor(redisClient?: Redis /*, ttl: number = 1000 * 60 * 2 */) {
        this.redis = redisClient;
        // this.ttl = ttl;
    }

    /**
     * Get or create room map (not using LRU cache directly for now)
     */
    private getRoom(roomId: string): Map<string, RoomMember> {
        // TODO: Integrate with LRU cache properly (get, set)
        let room = this.rooms.get(roomId);

        if (!room) {
            room = new Map();
            this.rooms.set(roomId, room);
        }

        return room;
    }

    /**
     * Apply presence update for a user
     * @param roomId The ID of the room
     * @param userId The ID of the user updating their presence
     * @param update Partial presence update. The 'u' (userId) and 't' (timestamp) fields will be managed internally.
     */
    public async updateUserPresence(roomId: string, userId: string, update: Partial<Omit<UserPresence, 'u' | 't'>>): Promise<void> {
        const room = this.getRoom(roomId);
        const existingMember = room.get(userId);
        const now = Math.floor(Date.now() / 1000); // epoch seconds

        // Prepare the base state, ensuring required fields have defaults
        const basePresence: Partial<UserPresence> = {
            s: 'unknown', // Default status if none provided
            ...(existingMember?.presence ?? {}),
        };

        // Merge existing state with the update, ensuring 's' is always a string
        const newPresence: UserPresence = {
            ...basePresence,
            ...update,
            u: userId,
            t: now,
            s: update.s ?? basePresence.s!, // Prioritize update.s, fallback to base.s (which has default)
        };

        // Update in-memory state
        room.set(userId, {
            presence: newPresence,
            lastActive: Date.now(),
        });

        // Prepare the diff for broadcasting
        const diff: PresenceDiff = {
            [userId]: newPresence,
        };

        // Publish diff to Redis Stream
        if (this.redis) {
            const streamKey = this.streamPrefix + roomId;
            try {
                await this.redis.xadd(
                    streamKey,
                    '*',
                    'data',
                    JSON.stringify(diff)
                );
            } catch (error) {
                console.error(`Error publishing presence diff to Redis stream ${streamKey}:`, error);
            }
        }
    }

    /**
     * Get full presence state for a room
     * Returns a map of userId -> UserPresence
     */
    public getFullPresenceState(roomId: string): Record<string, UserPresence> {
        const room = this.rooms.get(roomId);
        const result: Record<string, UserPresence> = {};

        if (room) {
            for (const [userId, member] of room.entries()) {
                // TODO: Check member.lastActive against a threshold?
                result[userId] = member.presence;
            }
        }

        return result;
    }

    /**
     * Remove a user from a room and publish a 'null' diff
     */
    public async removeUser(roomId: string, userId: string): Promise<void> {
        const room = this.rooms.get(roomId);
        let userExisted = false;
        if (room) {
            userExisted = room.delete(userId);
            if (room.size === 0) {
                this.rooms.delete(roomId);
                // TODO: Also remove from LRU cache
                // this.roomCache.delete(roomId);
            }
        }

        // Publish diff to Redis Stream if enabled and the user actually existed
        if (this.redis && userExisted) {
            const diff: PresenceDiff = {
                [userId]: null, // Indicate user left
            };
            const streamKey = this.streamPrefix + roomId;
            try {
                await this.redis.xadd(
                    streamKey,
                    '*',
                    'data', JSON.stringify(diff)
                    // 'MAXLEN', '~', 1000
                );
            } catch (error) {
                console.error(`Error publishing user removal diff to Redis stream ${streamKey}:`, error);
                // TODO: Add proper error handling/logging
            }
        }
    }

    /**
     * Cleanup expired presence - Note: primary cleanup likely in Edge DO
     * This might be used for local memory cleanup if needed.
     */
    public cleanup(): void {
        const now = Date.now();
        const timeout = 60 * 60 * 1000; // 1 hour (example)

        for (const [roomId, room] of this.rooms.entries()) {
            for (const [userId, member] of room.entries()) {
                if (now - member.lastActive > timeout) {
                    console.log(`Cleaning up inactive user ${userId} from room ${roomId} in local memory.`);
                    room.delete(userId); // Just remove from local map, don't publish null diff
                }
            }

            if (room.size === 0) {
                this.rooms.delete(roomId);
                // TODO: Also remove from LRU cache
                // this.roomCache.delete(roomId);
            }
        }
        // Also prune the main LRU cache
        this.roomCache.purgeStale();
    }

    // Read presence diffs from Redis Stream (for cross-pod sync)
    // TODO: Need to implement the logic to process these reads
    public async readDiffs(roomId: string, lastId: string = '$'): Promise<any[]> {
        if (!this.redis) return [];
        const stream = this.streamPrefix + roomId;
        try {
            // Use XREADGROUP for reliable processing if multiple pods read
            // Or XREAD if only one reader process is expected per stream
            const res = await this.redis.xread('BLOCK', 0, 'STREAMS', stream, lastId);
            // TODO: Process the response: parse 'data', apply locally if needed
            return res || [];
        } catch (error) {
            console.error(`Error reading presence diffs from Redis stream ${stream}:`, error);
            return []; // Return empty array on error
        }
    }
} 