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
 * Message types for WebSocket protocol
 */
export enum MessageType {
    PRESENCE_DIFF = 0x01,
    STORAGE_UPDATE = 0x02,
    COMMENT_ADD = 0x10,
    COMMENT_EDIT = 0x11,
    COMMENT_DEL = 0x12,
    REACTION_ADD = 0x13,
    REACTION_REMOVE = 0x14,
} 