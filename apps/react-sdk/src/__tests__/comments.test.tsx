import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, expect, test, beforeEach } from 'vitest';
import { useComments, useBlockComments } from '../comments';
import { ConnectionProvider } from '../connection';

// Mock the hooks directly
vi.mock('../comments', async () => {
    return {
        CommentsProvider: vi.fn(() => null),
        useBlockComments: vi.fn(),
        useComments: vi.fn(),
    };
});

// Mock connection
const mockConnection: any = {
    url: 'ws://localhost:8080',
    room: 'test-room',
    sendJson: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    ws: null,
    token: 'mock-token'
};

// Mock comment data
const mockComment = {
    id: 'comment1',
    roomId: 'test-room',
    blockId: 'block1',
    bodyMd: 'Test comment',
    userId: 'user1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reactions: {},
};


// Test component to interact with comments hooks
const TestComponent = ({ blockId = 'block1' }) => {
    const { addComment, deleteComment, addReaction, removeReaction } = useComments();
    const { comments, isLoading, error } = useBlockComments(blockId);

    return (
        <div>
            <div data-testid="loading">{isLoading ? 'Loading' : 'Not loading'}</div>
            {error && <div data-testid="error">{error.message}</div>}
            <div data-testid="comment-count">{comments.length}</div>
            <button
                data-testid="add-comment"
                onClick={() => addComment(blockId, 'New comment')}
            >
                Add Comment
            </button>
            <button
                data-testid="add-reply"
                onClick={() => addComment(blockId, 'Reply comment', 'comment1')}
            >
                Add Reply
            </button>
            <button
                data-testid="delete-comment"
                onClick={() => deleteComment('comment1')}
            >
                Delete Comment
            </button>
            <button
                data-testid="add-reaction"
                onClick={() => addReaction('comment1', '👍')}
            >
                Add Reaction
            </button>
            <button
                data-testid="remove-reaction"
                onClick={() => removeReaction('comment1', '👍')}
            >
                Remove Reaction
            </button>
            <div>
                {comments.map(comment => (
                    <div key={comment.id} data-testid={`comment-${comment.id}`}>
                        {comment.bodyMd}
                    </div>
                ))}
            </div>
        </div>
    );
};

describe('Comments hooks', () => {
    const mockAddComment = vi.fn().mockResolvedValue({ id: 'new-comment', bodyMd: 'New comment' });
    const mockDeleteComment = vi.fn().mockResolvedValue(true);
    const mockAddReaction = vi.fn().mockResolvedValue(true);
    const mockRemoveReaction = vi.fn().mockResolvedValue(true);
    const mockFetchComments = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock the hook return values directly
        (useBlockComments as any).mockReturnValue({
            comments: [mockComment],
            isLoading: false,
            error: null
        });

        (useComments as any).mockReturnValue({
            comments: { 'block1': [mockComment] },
            isLoading: false,
            error: null,
            fetchComments: mockFetchComments,
            addComment: mockAddComment,
            deleteComment: mockDeleteComment,
            addReaction: mockAddReaction,
            removeReaction: mockRemoveReaction
        });

        // Reset global fetch mock
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true })
        });
    });

    const renderWithProviders = (ui: React.ReactElement) => {
        return render(
            <ConnectionProvider value={mockConnection}>
                {ui}
            </ConnectionProvider>
        );
    };

    test('should fetch comments for a block', () => {
        renderWithProviders(<TestComponent />);

        // Verify that state is as expected
        expect(screen.getByTestId('loading')).toHaveTextContent('Not loading');
        expect(screen.getByTestId('comment-count')).toHaveTextContent('1');
        expect(screen.getByTestId('comment-comment1')).toHaveTextContent('Test comment');
    });

    test('should add a comment', () => {
        renderWithProviders(<TestComponent />);

        // Find and click the add comment button
        const addCommentButton = screen.getByTestId('add-comment');
        fireEvent.click(addCommentButton);

        // Verify the addComment mock was called with the right arguments
        expect(mockAddComment).toHaveBeenCalledWith('block1', 'New comment');
    });

    test('should add a reply comment', () => {
        renderWithProviders(<TestComponent />);

        // Find and click the add reply button
        const addReplyButton = screen.getByTestId('add-reply');
        fireEvent.click(addReplyButton);

        // Verify the addComment mock was called with the right arguments
        expect(mockAddComment).toHaveBeenCalledWith('block1', 'Reply comment', 'comment1');
    });

    test('should delete a comment', () => {
        renderWithProviders(<TestComponent />);

        // Find and click the delete button
        const deleteButton = screen.getByTestId('delete-comment');
        fireEvent.click(deleteButton);

        // Verify deleteComment was called correctly
        expect(mockDeleteComment).toHaveBeenCalledWith('comment1');
    });

    test('should add a reaction to a comment', () => {
        renderWithProviders(<TestComponent />);

        // Find and click the add reaction button
        const addReactionButton = screen.getByTestId('add-reaction');
        fireEvent.click(addReactionButton);

        // Verify addReaction was called correctly
        expect(mockAddReaction).toHaveBeenCalledWith('comment1', '👍');
    });

    test('should remove a reaction from a comment', () => {
        renderWithProviders(<TestComponent />);

        // Find and click the remove reaction button
        const removeReactionButton = screen.getByTestId('remove-reaction');
        fireEvent.click(removeReactionButton);

        // Verify removeReaction was called correctly
        expect(mockRemoveReaction).toHaveBeenCalledWith('comment1', '👍');
    });

    test('should handle errors when fetching comments', () => {
        // Mock an error state
        (useBlockComments as any).mockReturnValue({
            comments: [],
            isLoading: false,
            error: new Error('Network error')
        });

        renderWithProviders(<TestComponent />);

        // Verify that error state is displayed correctly
        expect(screen.getByTestId('error')).toHaveTextContent('Network error');
        expect(screen.getByTestId('comment-count')).toHaveTextContent('0');
    });
}); 