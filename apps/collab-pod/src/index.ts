import express, { Express, Request, Response, Router, NextFunction, RequestHandler } from 'express';
import http from 'http';
import WebSocket from 'ws';
import { PresenceManager } from './presence/manager';
import { StorageEngine } from './storage/engine';
// Using local enums and utilities instead of protocol imports
// Mock MessageType enum to match the protocol values
enum MessageType {
    PRESENCE_DIFF = 0x01,
    STORAGE_UPDATE = 0x02,
    COMMENT_ADD = 0x03,
    COMMENT_EDIT = 0x04,
    COMMENT_DEL = 0x05,
    REACTION_ADD = 0x06,
    REACTION_REMOVE = 0x07,
}

// Mock msgpack with basic encode/decode
const msgpack = {
    encode: (data: any) => Buffer.from(JSON.stringify(data)),
    decode: (data: Buffer) => JSON.parse(data.toString())
};

import { createComment, fetchComments, addReaction, removeReaction, deleteComment } from './comments';
import { canSendNotification, enqueueNotification, processQueue, deliverNotifications } from './notifications';
import { register, trackConnection, trackOperation, trackError, httpMetricsMiddleware, updateSystemMetrics } from './metrics';
import promBundle from 'express-prom-bundle';

// Define message type interfaces for local use
interface PresenceDiffMessage {
    type: number;
    userId: string;
    data: Record<string, any>;
}

interface StorageUpdateMessage {
    type: number;
    update: Uint8Array;
}

// Create Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Create managers
const presenceManager = new PresenceManager();
const storageEngine = new StorageEngine();

// Room ID -> Set of WebSocket clients
const roomClients: Record<string, Set<WebSocket>> = {};

// Configure Prometheus metrics middleware
const metricsMiddleware = promBundle({
    includeMethod: true,
    includePath: true,
    includeStatusCode: true,
    includeUp: true,
    customLabels: { app: 'collab-pod' },
    promClient: { collectDefaultMetrics: {} }
});

// Apply middlewares
app.use(metricsMiddleware);
app.use(httpMetricsMiddleware);
app.use(express.json()); // Add JSON request body parsing

// Basic health check
app.get('/health', ((req, res) => {
    res.status(200).send('OK');
}) as RequestHandler);

// Expose Prometheus metrics endpoint
app.get('/metrics', ((req, res) => {
    res.set('Content-Type', register.contentType);
    register.metrics()
        .then((metrics) => {
            res.end(metrics);
        })
        .catch((error) => {
            console.error('Error generating metrics:', error);
            res.status(500).end('Error generating metrics');
        });
}) as RequestHandler);

// Create API router for comments
const commentsRouter = express.Router();

// Comments REST API
// Get comments for a block
commentsRouter.get('/:blockId', (async (req, res) => {
    try {
        const { blockId } = req.params;
        const comments = await fetchComments(blockId);
        res.status(200).json(comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
}) as RequestHandler);

// Create a new comment
commentsRouter.post('/', (async (req, res) => {
    try {
        const { roomId, blockId, bodyMd, userId, parentId } = req.body;

        if (!roomId || !blockId || !bodyMd || !userId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const comment = await createComment(roomId, blockId, bodyMd, userId, parentId);

        // Broadcast to all clients in the room
        broadcastComment(roomId, comment);

        res.status(201).json(comment);
    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
}) as RequestHandler);

// Delete a comment
commentsRouter.delete('/:id', (async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const comment = await deleteComment(id, userId);

        // Broadcast to all clients in the room
        broadcastCommentDeletion(comment.roomId.toString(), id);

        res.status(200).json(comment);
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
}) as RequestHandler);

// Add a reaction to a comment
commentsRouter.post('/:commentId/reactions', (async (req, res) => {
    try {
        const { commentId } = req.params;
        const { emoji, userId, roomId } = req.body;

        if (!emoji || !userId || !roomId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const reaction = await addReaction(commentId, emoji, userId);

        // Broadcast to all clients in the room
        broadcastReactionAdd(roomId, commentId, emoji, userId);

        res.status(201).json(reaction);
    } catch (error) {
        console.error('Error adding reaction:', error);
        res.status(500).json({ error: 'Failed to add reaction' });
    }
}) as RequestHandler);

// Remove a reaction from a comment
commentsRouter.delete('/:commentId/reactions/:emoji', (async (req, res) => {
    try {
        const { commentId, emoji } = req.params;
        const { userId, roomId } = req.body;

        if (!userId || !roomId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await removeReaction(commentId, emoji, userId);

        // Broadcast to all clients in the room
        broadcastReactionRemove(roomId, commentId, emoji, userId);

        res.status(204).send();
    } catch (error) {
        console.error('Error removing reaction:', error);
        res.status(500).json({ error: 'Failed to remove reaction' });
    }
}) as RequestHandler);

// Mount the comments router
app.use('/api/comments', commentsRouter);

// WebSocket handler
wss.on('connection', (ws, req) => {
    // Parse URL query parameters
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room');
    const token = url.searchParams.get('token');

    // Generate a user ID (for MVP we're not validating tokens)
    const userId = 'user_' + Math.random().toString(36).substring(2, 9);

    // Track connection state
    let isAlive = true;

    console.log(`User ${userId} connected to room ${roomId}`);

    // Track connection in metrics if roomId exists
    if (roomId) {
        trackConnection(roomId, 'default', true);
    }

    // --- Broadcast channel logic ---
    if (roomId) {
        if (!roomClients[roomId]) roomClients[roomId] = new Set();
        roomClients[roomId].add(ws);
    }

    // Handle pings to keep connection alive
    ws.on('pong', () => {
        isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', (message: Buffer) => {
        // Try to parse as JSON for broadcast channel and comments
        try {
            const str = message.toString();
            if (str.startsWith('{')) {
                const data = JSON.parse(str);
                if (data.type === 'broadcast' && roomId) {
                    // Track broadcast operation
                    trackOperation(roomId, 'broadcast');

                    // Relay to all other clients in the room
                    for (const client of roomClients[roomId]) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(message);
                        }
                    }
                    return;
                }
                if (data.type === 'create_comment' && roomId && data.blockId && data.bodyMd && data.userId) {
                    // Track comment creation
                    trackOperation(roomId, 'create_comment');

                    // Create comment using the new database function
                    createComment(roomId, data.blockId, data.bodyMd, data.userId, data.parentId)
                        .then(comment => {
                            // Broadcast new comment to all clients in the room
                            broadcastComment(roomId, comment);
                        })
                        .catch(error => {
                            console.error('Error creating comment:', error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'comment_create_failed',
                                message: 'Failed to create comment'
                            }));
                        });
                    return;
                }
                if (data.type === 'fetch_comments' && data.blockId) {
                    // Track comment fetch
                    if (roomId) trackOperation(roomId, 'fetch_comments');

                    // Fetch comments using database
                    fetchComments(data.blockId)
                        .then(comments => {
                            ws.send(JSON.stringify({
                                type: 'comments',
                                blockId: data.blockId,
                                comments
                            }));
                        })
                        .catch(error => {
                            console.error('Error fetching comments:', error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'fetch_comments_failed',
                                message: 'Failed to fetch comments'
                            }));
                        });
                    return;
                }
                if (data.type === 'add_reaction' && data.commentId && data.emoji && data.userId && roomId) {
                    // Track reaction
                    trackOperation(roomId, 'add_reaction');

                    // Add reaction to database
                    addReaction(data.commentId, data.emoji, data.userId)
                        .then(() => {
                            // Broadcast reaction to all clients in the room
                            broadcastReactionAdd(roomId, data.commentId, data.emoji, data.userId);
                        })
                        .catch(error => {
                            console.error('Error adding reaction:', error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'add_reaction_failed',
                                message: 'Failed to add reaction'
                            }));
                        });
                    return;
                }
                if (data.type === 'remove_reaction' && data.commentId && data.emoji && data.userId && roomId) {
                    // Track reaction removal
                    trackOperation(roomId, 'remove_reaction');

                    // Remove reaction from database
                    removeReaction(data.commentId, data.emoji, data.userId)
                        .then(() => {
                            // Broadcast reaction removal to all clients in the room
                            broadcastReactionRemove(roomId, data.commentId, data.emoji, data.userId);
                        })
                        .catch(error => {
                            console.error('Error removing reaction:', error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'remove_reaction_failed',
                                message: 'Failed to remove reaction'
                            }));
                        });
                    return;
                }
                if (data.type === 'delete_comment' && data.commentId && data.userId && roomId) {
                    // Track comment deletion
                    trackOperation(roomId, 'delete_comment');

                    // Delete comment from database
                    deleteComment(data.commentId, data.userId)
                        .then(comment => {
                            // Broadcast comment deletion to all clients in the room
                            broadcastCommentDeletion(roomId, data.commentId);
                        })
                        .catch(error => {
                            console.error('Error deleting comment:', error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                code: 'delete_comment_failed',
                                message: 'Failed to delete comment'
                            }));
                        });
                    return;
                }
                // Handle notifications
                if (data.type === 'notify' && data.user && data.message) {
                    // Track notification
                    if (roomId) trackOperation(roomId, 'notification');

                    const target = data.user;
                    if (canSendNotification(target)) {
                        enqueueNotification(target, data.message, data.fail);
                    }
                    processQueue();
                    const deliveredList = deliverNotifications(target);
                    for (const n of deliveredList) {
                        ws.send(JSON.stringify({ type: 'notification', user: n.user, message: n.message }));
                    }
                    return;
                }
            }
        } catch (error) {
            // Track parse error
            if (roomId) trackError('parse_error');
            console.error('Error parsing message:', error);
        }
        try {
            // First byte is message type
            const messageType = message[0];
            const payload = message.slice(1);

            switch (messageType) {
                case MessageType.PRESENCE_DIFF:
                    if (roomId) trackOperation(roomId, 'presence_diff');
                    handlePresenceDiff(roomId || '', userId, payload);
                    break;

                case MessageType.STORAGE_UPDATE:
                    if (roomId) trackOperation(roomId, 'storage_update');
                    handleStorageUpdate(roomId || '', userId, payload);
                    break;

                // New message types for comments protocol
                case MessageType.COMMENT_ADD:
                    if (roomId) trackOperation(roomId, 'comment_add');
                    handleCommentAdd(roomId || '', payload);
                    break;

                case MessageType.COMMENT_EDIT:
                    if (roomId) trackOperation(roomId, 'comment_edit');
                    handleCommentEdit(roomId || '', payload);
                    break;

                case MessageType.COMMENT_DEL:
                    if (roomId) trackOperation(roomId, 'comment_del');
                    handleCommentDelete(roomId || '', payload);
                    break;

                case MessageType.REACTION_ADD:
                    if (roomId) trackOperation(roomId, 'reaction_add');
                    handleReactionAdd(roomId || '', payload);
                    break;

                case MessageType.REACTION_REMOVE:
                    if (roomId) trackOperation(roomId, 'reaction_remove');
                    handleReactionRemove(roomId || '', payload);
                    break;

                default:
                    console.warn(`Unknown message type: ${messageType}`);
                    if (roomId) trackError('unknown_message_type');
            }
        } catch (error) {
            // Track processing error
            if (roomId) trackError('processing_error');
            console.error('Error processing message:', error);
        }
    });

    // Handle connection close
    ws.on('close', () => {
        // Track disconnection in metrics if roomId exists
        if (roomId) {
            trackConnection(roomId, 'default', false);
        }

        if (roomId && roomClients[roomId]) {
            roomClients[roomId].delete(ws);
            if (roomClients[roomId].size === 0) delete roomClients[roomId];
        }
        console.log(`User ${userId} disconnected from room ${roomId}`);
        if (roomId) {
            presenceManager.removeUser(roomId, userId);
        }
        isAlive = false;
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for user ${userId} in room ${roomId}:`, error);
        if (roomId) trackError('ws_error');
    });

    // Send initial state
    if (roomId) {
        // Send presence state
        const presenceState = presenceManager.getFullState(roomId);
        ws.send(JSON.stringify({ type: 'presence_sync', presenceState }));

        // Send storage state
        const storageState = storageEngine.getState(roomId);
        const storageMessage = Buffer.concat([
            Buffer.from([MessageType.STORAGE_UPDATE]),
            Buffer.from(storageState)
        ]);
        ws.send(storageMessage);
    }

    // Helper function for handling presence updates
    function handlePresenceDiff(roomId: string, userId: string, payload: Buffer): void {
        try {
            const diff = msgpack.decode(payload) as PresenceDiffMessage;

            // Update presence state
            presenceManager.applyDiff(roomId, userId, diff.data);

            // Broadcast to all clients in the room
            broadcast(roomId, {
                type: MessageType.PRESENCE_DIFF,
                userId,
                data: diff.data,
            } as PresenceDiffMessage, ws);
        } catch (error) {
            console.error('Error handling presence diff:', error);
            trackError('presence_diff_error');
        }
    }

    // Helper function for handling storage updates
    function handleStorageUpdate(roomId: string, userId: string, payload: Buffer): void {
        try {
            // Apply update to storage engine
            const mergedUpdate = storageEngine.applyUpdate(roomId, new Uint8Array(payload));

            // Broadcast to all clients in the room
            const message: StorageUpdateMessage = {
                type: MessageType.STORAGE_UPDATE,
                update: mergedUpdate,
            };
            const buffer = Buffer.concat([
                Buffer.from([MessageType.STORAGE_UPDATE]),
                Buffer.from(msgpack.encode(message))
            ]);

            broadcastRaw(roomId, buffer, ws);
        } catch (error) {
            console.error('Error handling storage update:', error);
            trackError('storage_update_error');
        }
    }

    // Helper function for handling comment add
    async function handleCommentAdd(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;

            // Create comment in database
            const comment = await createComment(
                roomId,
                data.blockId,
                data.bodyMd,
                data.userId,
                data.parentId
            );

            // Broadcast to all clients in the room
            broadcastComment(roomId, comment);
        } catch (error) {
            console.error('Error handling comment add:', error);
            trackError('comment_add_error');
        }
    }

    // Helper function for handling comment edit (not fully implemented yet)
    async function handleCommentEdit(roomId: string, payload: Buffer): Promise<void> {
        // For future implementation
        console.warn('Comment edit not yet implemented');
    }

    // Helper function for handling comment delete
    async function handleCommentDelete(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;

            // Delete comment in database
            await deleteComment(data.id, data.userId);

            // Broadcast to all clients in the room
            broadcastCommentDeletion(roomId, data.id);
        } catch (error) {
            console.error('Error handling comment delete:', error);
            trackError('comment_delete_error');
        }
    }

    // Helper function for handling reaction add
    async function handleReactionAdd(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;

            // Add reaction in database
            await addReaction(data.commentId, data.emoji, data.userId);

            // Broadcast to all clients in the room
            broadcastReactionAdd(roomId, data.commentId, data.emoji, data.userId);
        } catch (error) {
            console.error('Error handling reaction add:', error);
            trackError('reaction_add_error');
        }
    }

    // Helper function for handling reaction remove
    async function handleReactionRemove(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;

            // Remove reaction from database
            await removeReaction(data.commentId, data.emoji, data.userId);

            // Broadcast to all clients in the room
            broadcastReactionRemove(roomId, data.commentId, data.emoji, data.userId);
        } catch (error) {
            console.error('Error handling reaction remove:', error);
            trackError('reaction_remove_error');
        }
    }
});

// Broadcast to all clients in a room
function broadcast(roomId: string, data: any, exclude?: WebSocket): void {
    const message = msgpack.encode(data);
    const buffer = Buffer.concat([
        Buffer.from([data.type]),
        Buffer.from(message)
    ]);

    broadcastRaw(roomId, buffer, exclude);
}

// Broadcast raw buffer to all clients in a room
function broadcastRaw(roomId: string, data: Buffer, exclude?: WebSocket): void {
    wss.clients.forEach(client => {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            // In a real implementation, we'd check if the client is in the room
            // For MVP, we broadcast to all clients
            client.send(data);
        }
    });
}

// Ping clients every 30 seconds to check if they're still alive
setInterval(() => {
    wss.clients.forEach(ws => {
        const client = ws as WebSocket & { isAlive?: boolean };

        if (client.isAlive === false) {
            return client.terminate();
        }

        client.isAlive = false;
        client.ping();
    });
}, 30000);

// Run cleanup every minute
setInterval(() => {
    presenceManager.cleanup();
}, 60000);

// Update system metrics every 15 seconds
updateSystemMetrics();

// Helper function to broadcast a new comment to all clients in a room
function broadcastComment(roomId: string, comment: any) {
    if (roomClients[roomId]) {
        const message = JSON.stringify({
            type: 'comment_add',
            comment
        });

        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

// Helper function to broadcast a comment deletion to all clients in a room
function broadcastCommentDeletion(roomId: string, commentId: string) {
    if (roomClients[roomId]) {
        const message = JSON.stringify({
            type: 'comment_del',
            commentId
        });

        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

// Helper function to broadcast a reaction addition to all clients in a room
function broadcastReactionAdd(roomId: string, commentId: string, emoji: string, userId: string) {
    if (roomClients[roomId]) {
        const message = JSON.stringify({
            type: 'reaction_add',
            commentId,
            emoji,
            userId
        });

        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

// Helper function to broadcast a reaction removal to all clients in a room
function broadcastReactionRemove(roomId: string, commentId: string, emoji: string, userId: string) {
    if (roomClients[roomId]) {
        const message = JSON.stringify({
            type: 'reaction_remove',
            commentId,
            emoji,
            userId
        });

        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 