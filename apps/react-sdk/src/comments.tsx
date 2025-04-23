import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useConnection } from './connection';

// Comment types
export interface Comment {
    id: string;
    roomId: string;
    blockId: string;
    bodyMd: string;
    userId: string;
    parentId?: string;
    createdAt: string;
    updatedAt: string;
    reactions?: Record<string, string[]>; // emoji -> user IDs
}

interface CommentsContextValue {
    // Comments data
    comments: Record<string, Comment[]>;
    isLoading: boolean;
    error: Error | null;

    // Actions
    fetchComments: (blockId: string) => Promise<void>;
    addComment: (blockId: string, bodyMd: string, parentId?: string) => Promise<Comment | null>;
    deleteComment: (commentId: string) => Promise<boolean>;
    addReaction: (commentId: string, emoji: string) => Promise<boolean>;
    removeReaction: (commentId: string, emoji: string) => Promise<boolean>;
}

// Context for comments
const CommentsContext = createContext<CommentsContextValue | null>(null);

// Provider component for comments
export function CommentsProvider({ children, userId }: {
    children: React.ReactNode;
    userId: string;
}) {
    const connection = useConnection();
    const [comments, setComments] = useState<Record<string, Comment[]>>({});
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    // Fetch comments for a specific block
    const fetchComments = useCallback(async (blockId: string): Promise<void> => {
        if (!connection || !blockId) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // First try to use WebSocket for real-time comments
            const promise = new Promise<Comment[]>((resolve) => {
                const handleComments = (responseBlockId: string, responseComments: Comment[]) => {
                    if (responseBlockId === blockId) {
                        connection.off('comments', handleComments);
                        resolve(responseComments);
                    }
                };

                connection.on('comments', handleComments);

                // Send comment fetch request via WebSocket
                connection.sendJson({
                    type: 'fetch_comments',
                    blockId
                });
            });

            // Set timeout to fallback to REST API if WebSocket doesn't respond
            const timeoutPromise = new Promise<Comment[]>(async (resolve) => {
                setTimeout(async () => {
                    try {
                        // Fallback to REST API
                        const response = await fetch(`${connection.url.replace(/^ws/, 'http')}/api/comments/${blockId}`);
                        if (!response.ok) {
                            throw new Error(`Failed to fetch comments: ${response.statusText}`);
                        }
                        const data = await response.json();
                        resolve(data);
                    } catch (err) {
                        console.error('Failed to fetch comments via fallback REST API:', err);
                        resolve([]);
                    }
                }, 3000); // 3 second timeout before fallback
            });

            // Use the first result that comes back
            const fetchedComments = await Promise.race([promise, timeoutPromise]);

            // Update comments state
            setComments(prevComments => ({
                ...prevComments,
                [blockId]: fetchedComments
            }));
        } catch (err) {
            console.error('Error fetching comments:', err);
            setError(err instanceof Error ? err : new Error('Failed to fetch comments'));
        } finally {
            setIsLoading(false);
        }
    }, [connection]);

    // Add a new comment
    const addComment = useCallback(async (
        blockId: string,
        bodyMd: string,
        parentId?: string
    ): Promise<Comment | null> => {
        if (!connection || !blockId || !bodyMd) {
            return null;
        }

        try {
            // Try to create comment via WebSocket first
            const wsPromise = new Promise<Comment>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    connection.off('comment_created', handleCommentCreated);
                    reject(new Error('WebSocket comment creation timed out'));
                }, 5000);

                const handleCommentCreated = (newComment: Comment) => {
                    if (newComment.blockId === blockId) {
                        clearTimeout(timeout);
                        connection.off('comment_created', handleCommentCreated);
                        resolve(newComment);
                    }
                };

                connection.on('comment_created', handleCommentCreated);

                // Send comment creation request via WebSocket
                connection.sendJson({
                    type: 'create_comment',
                    blockId,
                    bodyMd,
                    userId,
                    parentId
                });
            });

            // Fallback to REST API
            const restPromise = new Promise<Comment>(async (resolve, reject) => {
                setTimeout(async () => {
                    try {
                        const response = await fetch(`${connection.url.replace(/^ws/, 'http')}/api/comments`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                roomId: connection.room,
                                blockId,
                                bodyMd,
                                userId,
                                parentId
                            })
                        });

                        if (!response.ok) {
                            throw new Error(`Failed to create comment: ${response.statusText}`);
                        }

                        const newComment = await response.json();
                        resolve(newComment);
                    } catch (err) {
                        reject(err);
                    }
                }, 3000); // 3 second fallback timeout
            });

            // Use the first result that comes back
            const newComment = await Promise.race([wsPromise, restPromise]);

            // Update local state
            setComments(prevComments => {
                const blockComments = prevComments[blockId] || [];
                return {
                    ...prevComments,
                    [blockId]: [...blockComments, newComment]
                };
            });

            return newComment;
        } catch (err) {
            console.error('Error adding comment:', err);
            setError(err instanceof Error ? err : new Error('Failed to add comment'));
            return null;
        }
    }, [connection, userId]);

    // Delete a comment
    const deleteComment = useCallback(async (commentId: string): Promise<boolean> => {
        if (!connection || !commentId) {
            return false;
        }

        try {
            const response = await fetch(`${connection.url.replace(/^ws/, 'http')}/api/comments/${commentId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to delete comment: ${response.statusText}`);
            }

            // Update local state
            setComments(prevComments => {
                const newComments = { ...prevComments };

                // Find and remove the comment from all blocks
                for (const blockId in newComments) {
                    newComments[blockId] = newComments[blockId].filter(c => c.id !== commentId);
                }

                return newComments;
            });

            return true;
        } catch (err) {
            console.error('Error deleting comment:', err);
            setError(err instanceof Error ? err : new Error('Failed to delete comment'));
            return false;
        }
    }, [connection, userId]);

    // Add a reaction to a comment
    const addReaction = useCallback(async (commentId: string, emoji: string): Promise<boolean> => {
        if (!connection || !commentId || !emoji) {
            return false;
        }

        try {
            // Find which block this comment belongs to
            let targetBlockId = '';
            let targetComment: Comment | null = null;

            Object.entries(comments).forEach(([blockId, blockComments]) => {
                const comment = blockComments.find(c => c.id === commentId);
                if (comment) {
                    targetBlockId = blockId;
                    targetComment = comment;
                }
            });

            if (!targetBlockId || !targetComment) {
                throw new Error('Comment not found in local state');
            }

            const response = await fetch(`${connection.url.replace(/^ws/, 'http')}/api/comments/${commentId}/reactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    emoji,
                    userId,
                    roomId: connection.room
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to add reaction: ${response.statusText}`);
            }

            // Update local state
            setComments(prevComments => {
                const blockComments = prevComments[targetBlockId] || [];
                const updatedComments = blockComments.map(c => {
                    if (c.id === commentId) {
                        const reactions = c.reactions || {};
                        const users = reactions[emoji] || [];

                        if (!users.includes(userId)) {
                            return {
                                ...c,
                                reactions: {
                                    ...reactions,
                                    [emoji]: [...users, userId]
                                }
                            };
                        }
                    }
                    return c;
                });

                return {
                    ...prevComments,
                    [targetBlockId]: updatedComments
                };
            });

            return true;
        } catch (err) {
            console.error('Error adding reaction:', err);
            setError(err instanceof Error ? err : new Error('Failed to add reaction'));
            return false;
        }
    }, [connection, userId, comments]);

    // Remove a reaction from a comment
    const removeReaction = useCallback(async (commentId: string, emoji: string): Promise<boolean> => {
        if (!connection || !commentId || !emoji) {
            return false;
        }

        try {
            // Find which block this comment belongs to
            let targetBlockId = '';
            let targetComment: Comment | null = null;

            Object.entries(comments).forEach(([blockId, blockComments]) => {
                const comment = blockComments.find(c => c.id === commentId);
                if (comment) {
                    targetBlockId = blockId;
                    targetComment = comment;
                }
            });

            if (!targetBlockId || !targetComment) {
                throw new Error('Comment not found in local state');
            }

            const response = await fetch(`${connection.url.replace(/^ws/, 'http')}/api/comments/${commentId}/reactions/${emoji}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId,
                    roomId: connection.room
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to remove reaction: ${response.statusText}`);
            }

            // Update local state
            setComments(prevComments => {
                const blockComments = prevComments[targetBlockId] || [];
                const updatedComments = blockComments.map(c => {
                    if (c.id === commentId && c.reactions && c.reactions[emoji]) {
                        const reactions = { ...c.reactions };
                        reactions[emoji] = reactions[emoji].filter(id => id !== userId);

                        // Remove the emoji key if no users left
                        if (reactions[emoji].length === 0) {
                            delete reactions[emoji];
                        }

                        return {
                            ...c,
                            reactions
                        };
                    }
                    return c;
                });

                return {
                    ...prevComments,
                    [targetBlockId]: updatedComments
                };
            });

            return true;
        } catch (err) {
            console.error('Error removing reaction:', err);
            setError(err instanceof Error ? err : new Error('Failed to remove reaction'));
            return false;
        }
    }, [connection, userId, comments]);

    // Listen for real-time comment updates
    useEffect(() => {
        if (!connection) return;

        // Handle new comments
        const handleNewComment = (comment: Comment) => {
            setComments(prevComments => {
                const blockComments = prevComments[comment.blockId] || [];
                // Only add if not already in the list
                if (!blockComments.some(c => c.id === comment.id)) {
                    return {
                        ...prevComments,
                        [comment.blockId]: [...blockComments, comment]
                    };
                }
                return prevComments;
            });
        };

        // Handle comment deletions
        const handleCommentDeleted = (commentId: string) => {
            setComments(prevComments => {
                const newComments = { ...prevComments };

                // Find and remove the comment from all blocks
                for (const blockId in newComments) {
                    newComments[blockId] = newComments[blockId].filter(c => c.id !== commentId);
                }

                return newComments;
            });
        };

        // Handle reaction additions
        const handleReactionAdded = (commentId: string, emoji: string, reactionUserId: string) => {
            setComments(prevComments => {
                const newComments = { ...prevComments };

                // Find the comment and add the reaction
                for (const blockId in newComments) {
                    newComments[blockId] = newComments[blockId].map(c => {
                        if (c.id === commentId) {
                            const reactions = c.reactions || {};
                            const users = reactions[emoji] || [];

                            if (!users.includes(reactionUserId)) {
                                return {
                                    ...c,
                                    reactions: {
                                        ...reactions,
                                        [emoji]: [...users, reactionUserId]
                                    }
                                };
                            }
                        }
                        return c;
                    });
                }

                return newComments;
            });
        };

        // Handle reaction removals
        const handleReactionRemoved = (commentId: string, emoji: string, reactionUserId: string) => {
            setComments(prevComments => {
                const newComments = { ...prevComments };

                // Find the comment and remove the reaction
                for (const blockId in newComments) {
                    newComments[blockId] = newComments[blockId].map(c => {
                        if (c.id === commentId && c.reactions && c.reactions[emoji]) {
                            const reactions = { ...c.reactions };
                            reactions[emoji] = reactions[emoji].filter(id => id !== reactionUserId);

                            // Remove the emoji key if no users left
                            if (reactions[emoji].length === 0) {
                                delete reactions[emoji];
                            }

                            return {
                                ...c,
                                reactions
                            };
                        }
                        return c;
                    });
                }

                return newComments;
            });
        };

        connection.on('comment_created', handleNewComment);
        connection.on('comment_deleted', handleCommentDeleted);
        connection.on('reaction_added', handleReactionAdded);
        connection.on('reaction_removed', handleReactionRemoved);

        return () => {
            connection.off('comment_created', handleNewComment);
            connection.off('comment_deleted', handleCommentDeleted);
            connection.off('reaction_added', handleReactionAdded);
            connection.off('reaction_removed', handleReactionRemoved);
        };
    }, [connection]);

    const contextValue: CommentsContextValue = {
        comments,
        isLoading,
        error,
        fetchComments,
        addComment,
        deleteComment,
        addReaction,
        removeReaction
    };

    return (
        <CommentsContext.Provider value={contextValue}>
            {children}
        </CommentsContext.Provider>
    );
}

// Hook to use comments
export function useComments() {
    const context = useContext(CommentsContext);
    if (!context) {
        throw new Error('useComments must be used within a CommentsProvider');
    }
    return context;
}

// Hook to get comments for a specific block
export function useBlockComments(blockId: string) {
    const { comments, isLoading, error, fetchComments } = useComments();

    useEffect(() => {
        if (blockId) {
            fetchComments(blockId);
        }
    }, [blockId, fetchComments]);

    return {
        comments: comments[blockId] || [],
        isLoading,
        error
    };
} 