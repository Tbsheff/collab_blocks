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