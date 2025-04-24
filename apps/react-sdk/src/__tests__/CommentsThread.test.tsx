import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentsThread } from '../comments/CommentsThread';
import * as commentsHooks from '../comments';

// Mock the hooks using Vitest
vi.mock('../comments', () => ({
    useBlockComments: vi.fn(),
    useComments: vi.fn(),
}));

describe('CommentsThread', () => {
    const mockBlockId = 'block1';
    const mockUserId = 'user1';
    const mockComments = [
        {
            id: 'comment1',
            roomId: 'test-room',
            blockId: mockBlockId,
            bodyMd: 'Test comment',
            userId: mockUserId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reactions: { '👍': ['user2'] },
        },
        {
            id: 'comment2',
            roomId: 'test-room',
            blockId: mockBlockId,
            bodyMd: 'Test reply',
            userId: 'user2',
            parentId: 'comment1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reactions: {},
        },
    ];

    const mockAddComment = vi.fn().mockImplementation(() => {
        return Promise.resolve({ id: 'new-comment', bodyMd: 'New comment' });
    });

    const mockDeleteComment = vi.fn().mockImplementation(() => {
        return Promise.resolve(true);
    });

    const mockAddReaction = vi.fn().mockImplementation(() => {
        return Promise.resolve(true);
    });

    const mockRemoveReaction = vi.fn().mockImplementation(() => {
        return Promise.resolve(true);
    });

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock hook implementations
        (commentsHooks.useBlockComments as ReturnType<typeof vi.fn>).mockReturnValue({
            comments: mockComments,
            isLoading: false,
            error: null,
        });

        (commentsHooks.useComments as ReturnType<typeof vi.fn>).mockReturnValue({
            addComment: mockAddComment,
            deleteComment: mockDeleteComment,
            addReaction: mockAddReaction,
            removeReaction: mockRemoveReaction,
        });
    });

    test('renders the comments thread with comments', () => {
        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
                userName="Test User"
            />
        );

        // Check if comments header is rendered
        expect(screen.getByText('Comments')).toBeInTheDocument();

        // Check if comments are rendered
        expect(screen.getByText('Test comment')).toBeInTheDocument();
        expect(screen.getByText('Test reply')).toBeInTheDocument();
    });

    test('displays loading state while fetching comments', () => {
        (commentsHooks.useBlockComments as ReturnType<typeof vi.fn>).mockReturnValue({
            comments: [],
            isLoading: true,
            error: null,
        });

        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
            />
        );

        expect(screen.getByText('Loading comments...')).toBeInTheDocument();
    });

    test('displays error message when fetching comments fails', () => {
        const errorMessage = 'Failed to fetch comments';
        (commentsHooks.useBlockComments as ReturnType<typeof vi.fn>).mockReturnValue({
            comments: [],
            isLoading: false,
            error: new Error(errorMessage),
        });

        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
            />
        );

        expect(screen.getByText(`Failed to load comments: ${errorMessage}`)).toBeInTheDocument();
    });

    test('allows adding a new comment', () => {
        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
            />
        );

        // Get the textarea and add some text
        const textarea = screen.getByTestId('comment-input');
        fireEvent.change(textarea, { target: { value: 'New comment' } });

        // Submit the form
        const submitButton = screen.getByTestId('post-button');
        fireEvent.click(submitButton);

        // Verify addComment was called with the right args
        expect(mockAddComment).toHaveBeenCalledWith(mockBlockId, 'New comment');
    });

    test('allows adding a reaction to a comment', () => {
        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
            />
        );

        // Find the reaction buttons for the first comment
        const reactionButtons = screen.getAllByText('👍');
        // Click the first one
        fireEvent.click(reactionButtons[0]);

        // Verify addReaction was called with the right args
        expect(mockAddReaction).toHaveBeenCalledWith('comment1', '👍');
    });

    test('allows deleting own comment', () => {
        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
            />
        );

        // Find the delete button for the user's own comment
        const deleteButton = screen.getByTestId('delete-comment-comment1');
        fireEvent.click(deleteButton);

        // Verify deleteComment was called with the right args
        expect(mockDeleteComment).toHaveBeenCalledWith('comment1');
    });

    test('shows empty state when no comments', () => {
        (commentsHooks.useBlockComments as ReturnType<typeof vi.fn>).mockReturnValue({
            comments: [],
            isLoading: false,
            error: null,
        });

        render(
            <CommentsThread
                blockId={mockBlockId}
                userId={mockUserId}
            />
        );

        // Use data-testid to find the empty message
        const emptyMessage = screen.getByTestId('empty-message');
        expect(emptyMessage).toBeInTheDocument();
        expect(emptyMessage).toHaveTextContent('No comments yet. Be the first to comment!');
    });
}); 