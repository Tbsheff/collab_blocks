# Threaded Comments Implementation Guide

This guide outlines the implementation of the threaded comments functionality for CollabBlocks.

## Overview

The implementation consists of:

1. **React SDK Hooks**: The `comments.tsx` file provides all necessary hooks to interact with comments.
2. **CommentsThread Component**: The UI component for rendering and interacting with comments.
3. **Demo Web Integration**: The demo application now includes a comments section toggle.
4. **Tests**: Unit tests and E2E tests for verifying functionality.

## Setup Instructions

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start the database and collab-pod server:
   ```bash
   docker-compose up -d
   cd apps/collab-pod
   pnpm dev
   ```

3. In a separate terminal, start the demo web application:
   ```bash
   cd apps/demo-web
   pnpm dev
   ```

## Implementation Details

### React SDK Implementation

The React SDK provides the following hooks:

- `CommentsProvider`: Context provider for comments functionality
- `useComments()`: Hook to access comments actions (add, delete, react)
- `useBlockComments(blockId)`: Hook to access comments for a specific block

These hooks handle:
- Real-time updates using WebSockets
- Fallback to REST API when needed
- Optimistic UI updates
- Threaded comment structure

### Testing Implementation

To run unit tests:
```bash
cd apps/react-sdk
pnpm test
```

For E2E tests, first install Playwright:
```bash
cd apps/demo-web
pnpm add -D @playwright/test
npx playwright install
```

Then run the tests:
```bash
npx playwright test
```

## Features Implemented

1. **Thread Support**: Comments can be nested with parent-child relationships
2. **Emoji Reactions**: Users can add/remove emoji reactions to comments
3. **Real-time Updates**: All changes sync across clients
4. **Delete Comments**: Users can delete their own comments

## API Reference

### Comment Object

```typescript
interface Comment {
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
```

### Hook Functions

- `useComments()` - Returns:
  - `addComment(blockId, bodyMd, parentId?)`: Add a new comment or reply
  - `deleteComment(commentId)`: Delete a comment
  - `addReaction(commentId, emoji)`: Add reaction to a comment
  - `removeReaction(commentId, emoji)`: Remove reaction from a comment

- `useBlockComments(blockId)` - Returns:
  - `comments`: Array of comments for the block
  - `isLoading`: Loading state
  - `error`: Error state

## Manual Testing

1. Open two browser windows side by side
2. Navigate to the demo app in both: http://localhost:3000
3. Click "Show Comments" in both windows
4. Add a comment in one window and verify it appears in the other
5. Reply to that comment and verify threading works
6. Add reactions and verify they sync
7. Delete a comment and verify it's removed from both clients 