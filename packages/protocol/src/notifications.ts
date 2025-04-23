/**
 * Notification event for in-app and external delivery
 */
export interface Notification {
    id: string; // ULID
    orgId: string;
    type: NotificationType;
    roomId: string;
    actorId: string;
    targetIds: string[];
    payload: Record<string, any>;
    ts: string; // ISO timestamp
}

export enum NotificationType {
    COMMENT_POSTED = 'COMMENT_POSTED',
    MENTION = 'MENTION',
    REACTION = 'REACTION',
    SYSTEM = 'SYSTEM',
} 