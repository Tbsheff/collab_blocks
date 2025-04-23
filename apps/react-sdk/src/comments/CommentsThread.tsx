import React, { useState } from 'react';
import { useBlockComments, useComments } from '../comments';

export interface CommentsThreadProps {
    blockId: string;
    userId: string;
    userName?: string;
    userAvatar?: string;
    onClose?: () => void;
    maxHeight?: string | number;
    className?: string;
}

/**
 * A component for displaying and creating comments for a specific block
 */
export const CommentsThread: React.FC<CommentsThreadProps> = ({
    blockId,
    userId,
    userName = 'Anonymous',
    userAvatar,
    onClose,
    maxHeight = '400px',
    className = '',
}) => {
    const { comments, isLoading, error } = useBlockComments(blockId);
    const [newComment, setNewComment] = useState('');
    const { addComment, deleteComment, addReaction, removeReaction } = useComments();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newComment.trim()) return;

        try {
            await addComment(blockId, newComment);
            setNewComment('');
        } catch (err) {
            console.error('Failed to add comment:', err);
        }
    };

    const handleReaction = async (commentId: string, emoji: string, hasReacted: boolean) => {
        try {
            if (hasReacted) {
                await removeReaction(commentId, emoji);
            } else {
                await addReaction(commentId, emoji);
            }
        } catch (err) {
            console.error('Failed to toggle reaction:', err);
        }
    };

    const handleDelete = async (commentId: string) => {
        try {
            await deleteComment(commentId);
        } catch (err) {
            console.error('Failed to delete comment:', err);
        }
    };

    // Check if user has reacted with a specific emoji
    const hasUserReacted = (reactions: Record<string, string[]> | undefined, emoji: string) => {
        if (!reactions || !reactions[emoji]) return false;
        return reactions[emoji].includes(userId);
    };

    // Group comments by parent-child relationships
    const commentThreads = React.useMemo(() => {
        const rootComments = comments.filter(c => !c.parentId);
        const commentMap = comments.reduce((acc, comment) => {
            acc[comment.id] = {
                ...comment,
                children: [],
            };
            return acc;
        }, {} as Record<string, any>);

        // Add children to their parents
        comments.forEach(comment => {
            if (comment.parentId && commentMap[comment.parentId]) {
                commentMap[comment.parentId].children.push(commentMap[comment.id]);
            }
        });

        return rootComments.map(c => commentMap[c.id]);
    }, [comments]);

    // Render a comment and its replies
    const renderComment = (comment: any, level = 0) => {
        const { id, bodyMd, userId: commentUserId, createdAt, reactions = {}, children = [] } = comment;
        const isOwnComment = commentUserId === userId;
        const formattedDate = new Date(createdAt).toLocaleString();
        const indentClass = level > 0 ? `ml-${Math.min(level * 4, 12)}` : '';

        return (
            <div key={id} className={`comment-item ${indentClass} mb-4`}>
                <div className="flex items-start">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userName} className="w-8 h-8 rounded-full mr-2" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center mr-2">
                            {userName.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div className="flex-1">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold">{userName}</span>
                            <span className="text-xs text-gray-500">{formattedDate}</span>
                        </div>
                        <div className="comment-body mt-1">
                            {bodyMd}
                        </div>
                        <div className="comment-actions mt-2 flex items-center space-x-4">
                            <button
                                onClick={() => setNewComment(`@${userName} `)}
                                className="text-sm text-blue-500 hover:underline"
                            >
                                Reply
                            </button>
                            {isOwnComment && (
                                <button
                                    onClick={() => handleDelete(id)}
                                    className="text-sm text-red-500 hover:underline"
                                >
                                    Delete
                                </button>
                            )}
                            <div className="flex space-x-2">
                                {['👍', '❤️', '😂', '😮'].map(emoji => {
                                    const count = reactions[emoji]?.length || 0;
                                    const hasReacted = hasUserReacted(reactions, emoji);
                                    return (
                                        <button
                                            key={emoji}
                                            onClick={() => handleReaction(id, emoji, hasReacted)}
                                            className={`reaction-btn px-2 py-1 rounded ${hasReacted ? 'bg-blue-100' : 'bg-gray-100'
                                                }`}
                                        >
                                            {emoji} {count > 0 && <span className="reaction-count">{count}</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
                {children.length > 0 && (
                    <div className="replies mt-2">
                        {children.map((child: any) => renderComment(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={`comments-thread border rounded-lg p-4 ${className}`}>
            <div className="comments-header flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Comments</h3>
                {onClose && (
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        ✕
                    </button>
                )}
            </div>

            {error && <div className="error text-red-500 mb-4">Failed to load comments: {error.message}</div>}

            <div
                className="comments-list mb-4 overflow-y-auto"
                style={{ maxHeight }}
            >
                {isLoading ? (
                    <div className="loading text-center py-4">Loading comments...</div>
                ) : commentThreads.length === 0 ? (
                    <div className="empty-state text-center py-4 text-gray-500">
                        No comments yet. Be the first to comment!
                    </div>
                ) : (
                    commentThreads.map(comment => renderComment(comment))
                )}
            </div>

            <form onSubmit={handleSubmit} className="comment-form">
                <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="w-full border rounded-lg p-2 mb-2"
                    rows={3}
                />
                <button
                    type="submit"
                    disabled={!newComment.trim()}
                    className={`px-4 py-2 rounded ${!newComment.trim() ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                >
                    Post
                </button>
            </form>
        </div>
    );
}; 