/**
 * All message types for the wire protocol
 */
export enum MessageType {
    PRESENCE_DIFF = 0x01,
    STORAGE_UPDATE = 0x02,
    COMMENT_ADD = 0x10,
    COMMENT_EDIT = 0x11,
    COMMENT_DEL = 0x12,
    REACTION_ADD = 0x13,
    REACTION_REMOVE = 0x14,
    PRESENCE_SYNC = 0x20,
    STORAGE_SYNC = 0x21,
    ERROR = 0xfe,
    SYSTEM = 0xff,
}

/**
 * Presence diff message
 */
export interface PresenceDiffMessage {
    type: MessageType.PRESENCE_DIFF;
    userId: string;
    data: Record<string, any>;
}

/**
 * Storage update message
 */
export interface StorageUpdateMessage {
    type: MessageType.STORAGE_UPDATE;
    update: Uint8Array;
}

/**
 * Comment add/edit/delete message
 */
export interface CommentMessage {
    type: MessageType.COMMENT_ADD | MessageType.COMMENT_EDIT | MessageType.COMMENT_DEL;
    comment: import('./comments').Comment;
}

/**
 * Reaction add/remove message
 */
export interface ReactionMessage {
    type: MessageType.REACTION_ADD | MessageType.REACTION_REMOVE;
    reaction: import('./comments').Reaction;
}

/**
 * Presence sync message (full state)
 */
export interface PresenceSyncMessage {
    type: MessageType.PRESENCE_SYNC;
    presenceList: import('./presence').PresenceState[];
}

/**
 * Storage sync message (full state)
 */
export interface StorageSyncMessage {
    type: MessageType.STORAGE_SYNC;
    update: Uint8Array;
}

/**
 * Error message
 */
export interface ErrorMessage {
    type: MessageType.ERROR;
    code: string;
    message: string;
}

/**
 * System message (for system events, notifications, etc.)
 */
export interface SystemMessage {
    type: MessageType.SYSTEM;
    event: string;
    payload?: any;
}

/**
 * Comment add message
 */
export interface CommentAddMessage {
    type: MessageType.COMMENT_ADD;
    id: string;
    roomId: string;
    blockId: string;
    parentId?: string | null;
    userId: string;
    bodyMd: string;
    timestamp: number;
}

/**
 * Comment edit message
 */
export interface CommentEditMessage {
    type: MessageType.COMMENT_EDIT;
    id: string;
    bodyMd: string;
    timestamp: number;
}

/**
 * Comment delete message
 */
export interface CommentDeleteMessage {
    type: MessageType.COMMENT_DEL;
    id: string;
    timestamp: number;
}

/**
 * Reaction add message
 */
export interface ReactionAddMessage {
    type: MessageType.REACTION_ADD;
    commentId: string;
    emoji: string;
    userId: string;
    timestamp: number;
}

/**
 * Reaction remove message
 */
export interface ReactionRemoveMessage {
    type: MessageType.REACTION_REMOVE;
    commentId: string;
    emoji: string;
    userId: string;
    timestamp: number;
} 