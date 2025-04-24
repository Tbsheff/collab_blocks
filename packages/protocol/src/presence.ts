/**
 * Represents a user's presence state in a room
 */
export interface PresenceState {
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
 * Represents the presence state of a single user.
 */
export interface UserPresence {
    /** User ID */
    u: string;
    /** Cursor position (optional) */
    c?: { x: number; y: number };
    /** User status (e.g., "editing", "viewing") */
    s: string;
    /** Last seen timestamp (epoch seconds) */
    t: number;
    /** Any other custom presence data */
    [key: string]: any;
}

/**
 * Represents the complete presence state for a room, mapping user IDs to their presence.
 */
export type RoomPresenceState = Record<string, UserPresence>;

/**
 * Represents a diff update for presence state.
 * Can include updates for multiple users.
 * If a user ID maps to `null`, it means the user has left.
 */
export type PresenceDiff = Record<string, UserPresence | null>; 