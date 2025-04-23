import { ulid } from 'ulid';
import prisma from './db/client';

export type Comment = {
    id: string;
    roomId: string | bigint;
    blockId: string;
    parentId?: string | null;
    path: string;
    userId: string;
    bodyMd: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    reactions: Reaction[];
    replies?: Comment[]; // For API response
};

export type Reaction = {
    commentId: string;
    emoji: string;
    userId: string;
    createdAt: Date;
};

// Create a new comment
export async function createComment(
    roomId: string | bigint,
    blockId: string,
    bodyMd: string,
    userId: string,
    parentId?: string
): Promise<Comment> {
    // Generate a unique ID using ULID (better than random for sorting/storage)
    const id = ulid();

    // Get parent's path or create a new root path
    let path = id;

    if (parentId) {
        const parent = await prisma.comment.findUnique({
            where: { id: parentId },
            select: { path: true }
        });

        if (!parent) {
            throw new Error(`Parent comment ${parentId} not found`);
        }

        // Build path based on parent's path
        path = `${parent.path}.${id}`;
    }

    // Convert roomId to BigInt if it's a string
    const roomIdBigInt = typeof roomId === 'string' ? BigInt(roomId) : roomId;

    // Create comment in database
    const comment = await prisma.comment.create({
        data: {
            id,
            roomId: roomIdBigInt,
            blockId,
            parentId,
            path,
            userId,
            bodyMd,
        },
        include: {
            reactions: true
        }
    });

    return {
        ...comment,
        roomId: comment.roomId.toString(), // Convert BigInt to string for JSON
        replies: []
    };
}

// Fetch all comments for a specific block
export async function fetchComments(blockId: string): Promise<Comment[]> {
    // Get flat list of comments
    const comments = await prisma.comment.findMany({
        where: {
            blockId,
            deletedAt: null
        },
        include: {
            reactions: true
        },
        orderBy: {
            createdAt: 'asc' // Order by creation time
        }
    });

    // Convert to hierarchical structure
    return buildCommentTree(comments.map(c => ({
        ...c,
        roomId: c.roomId.toString(), // Convert BigInt to string for JSON
        replies: []
    })));
}

// Add a reaction to a comment
export async function addReaction(commentId: string, emoji: string, userId: string): Promise<Reaction> {
    // First check if the reaction already exists
    const existing = await prisma.reaction.findUnique({
        where: {
            commentId_emoji_userId: {
                commentId,
                emoji,
                userId
            }
        }
    });

    if (existing) {
        return existing;
    }

    // Create the reaction
    return prisma.reaction.create({
        data: {
            commentId,
            emoji,
            userId
        }
    });
}

// Remove a reaction from a comment
export async function removeReaction(commentId: string, emoji: string, userId: string): Promise<void> {
    await prisma.reaction.delete({
        where: {
            commentId_emoji_userId: {
                commentId,
                emoji,
                userId
            }
        }
    });
}

// Soft delete a comment (mark as deleted)
export async function deleteComment(id: string, userId: string): Promise<Comment> {
    // Check if user is the author
    const comment = await prisma.comment.findUnique({
        where: { id },
        select: { userId: true }
    });

    if (!comment) {
        throw new Error(`Comment ${id} not found`);
    }

    if (comment.userId !== userId) {
        throw new Error('Only comment author can delete a comment');
    }

    // Soft delete
    const deletedComment = await prisma.comment.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: { reactions: true }
    });

    return {
        ...deletedComment,
        roomId: deletedComment.roomId.toString(),
        replies: []
    };
}

// Helper to build a tree structure from flat comments array
function buildCommentTree(comments: Comment[]): Comment[] {
    const commentMap: Record<string, Comment> = {};
    const roots: Comment[] = [];

    // First pass: create lookup map
    comments.forEach(comment => {
        commentMap[comment.id] = { ...comment, replies: [] };
    });

    // Second pass: build tree
    comments.forEach(comment => {
        if (comment.parentId && commentMap[comment.parentId]) {
            // Add as reply to parent
            if (!commentMap[comment.parentId].replies) {
                commentMap[comment.parentId].replies = [];
            }
            commentMap[comment.parentId].replies!.push(commentMap[comment.id]);
        } else {
            // It's a root comment
            roots.push(commentMap[comment.id]);
        }
    });

    return roots;
} 