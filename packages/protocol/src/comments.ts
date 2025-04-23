/**
 * Comment entity for threaded discussions
 */
export interface Comment {
    id: string; // ULID
    roomId: string;
    parentId?: string; // ULID of parent comment
    path: string[]; // Ancestor path for threading
    userId: string;
    body: string; // Markdown
    createdAt: string; // ISO timestamp
    updatedAt?: string; // ISO timestamp
    deletedAt?: string; // ISO timestamp
}

/**
 * Reaction entity for comments
 */
export interface Reaction {
    commentId: string;
    emoji: string;
    userId: string;
    createdAt: string; // ISO timestamp
} 