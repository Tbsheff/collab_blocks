import { PresenceState } from '@collabblocks/protocol';
import LRU from 'lru-cache';

interface UserPresence {
    userId: string;
    state: PresenceState;
    lastActive: number;
}

/**
 * Manages presence state for rooms
 */
export class PresenceManager {
    // Room ID -> Map of User ID -> Presence State
    private rooms = new Map<string, LRU<string, UserPresence>>();

    /**
     * Get or create LRU cache for a room
     */
    private getRoom(roomId: string): LRU<string, UserPresence> {
        let room = this.rooms.get(roomId);

        if (!room) {
            room = new LRU<string, UserPresence>({
                max: 1000, // Maximum 1000 users per room
                ttl: 1000 * 60 * 2, // 2 minutes TTL
            });

            this.rooms.set(roomId, room);
        }

        return room;
    }

    /**
     * Apply presence update for a user
     */
    public applyDiff(roomId: string, userId: string, diff: Partial<PresenceState>): void {
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
} 