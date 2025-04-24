import express, { Express, Request, Response, Router, RequestHandler } from 'express';
import http from 'http';
import WebSocket from 'ws';
import { PresenceManager } from './presence/manager';
import { StorageEngine } from './storage/engine';
import promBundle from 'express-prom-bundle';
import { register } from 'prom-client';
import { authMiddleware, verifyWebSocketToken } from '../../packages/auth/src'; // Using relative path
import { trackConnection, trackOperation, trackError, httpMetricsMiddleware } from './metrics';
import { createComment, fetchComments, addReaction, removeReaction, deleteComment } from './comments';

enum MessageType {
    PRESENCE_DIFF = 0x01,
    STORAGE_UPDATE = 0x02,
    COMMENT_ADD = 0x03,
    COMMENT_EDIT = 0x04,
    COMMENT_DEL = 0x05,
    REACTION_ADD = 0x06,
    REACTION_REMOVE = 0x07,
}

const msgpack = {
    encode: (data: any) => Buffer.from(JSON.stringify(data)),
    decode: (data: Buffer) => JSON.parse(data.toString())
};

function broadcastComment(roomId: string, comment: any) {
    if (roomClients[roomId]) {
        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'new_comment', comment }));
            }
        }
    }
}

function broadcastCommentDeletion(roomId: string, commentId: string) {
    if (roomClients[roomId]) {
        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'delete_comment', commentId }));
            }
        }
    }
}

function broadcastReactionAdd(roomId: string, commentId: string, emoji: string, userId: string) {
    if (roomClients[roomId]) {
        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'add_reaction', commentId, emoji, userId }));
            }
        }
    }
}

function broadcastReactionRemove(roomId: string, commentId: string, emoji: string, userId: string) {
    if (roomClients[roomId]) {
        for (const client of roomClients[roomId]) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'remove_reaction', commentId, emoji, userId }));
            }
        }
    }
}

interface PresenceDiffMessage {
    type: number;
    userId: string;
    data: Record<string, any>;
}

interface StorageUpdateMessage {
    type: number;
    update: Uint8Array;
}

const app: Express = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const presenceManager = new PresenceManager();
const storageEngine = new StorageEngine();

const roomClients: Record<string, Set<WebSocket>> = {};

const metricsMiddleware = promBundle({
    includeMethod: true,
    includePath: true,
    includeStatusCode: true,
    includeUp: true,
    customLabels: { app: 'collab-pod' },
    promClient: { collectDefaultMetrics: {} }
});

app.use(metricsMiddleware);
app.use(httpMetricsMiddleware);
app.use(express.json());

app.get('/health', ((req: Request, res: Response) => {
    res.status(200).send('OK');
}) as RequestHandler);

app.get('/metrics', ((req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    register.metrics().then((metrics: string) => res.end(metrics)).catch((error: Error) => {
        console.error('Error generating metrics:', error);
        res.status(500).end('Error generating metrics');
    });
}) as RequestHandler);

const commentsRouter = Router();
commentsRouter.use(authMiddleware());

commentsRouter.get('/:blockId', async (req: Request, res: Response) => {
    try {
        const { blockId } = req.params;
        const comments = await fetchComments(blockId);
        res.status(200).json(comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

commentsRouter.post('/', async (req: Request, res: Response) => {
    try {
        const { roomId, blockId, bodyMd, parentId } = req.body;
        const userId = (req as any).user.userId;
        if (!roomId || !blockId || !bodyMd) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const comment = await createComment(roomId, blockId, bodyMd, userId, parentId);
        broadcastComment(roomId, comment);
        res.status(201).json(comment);
    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
});

commentsRouter.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user.userId;
        const comment = await deleteComment(id, userId);
        broadcastCommentDeletion(comment.roomId.toString(), id);
        res.status(200).json(comment);
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

commentsRouter.post('/:commentId/reactions', async (req: Request, res: Response) => {
    try {
        const { commentId } = req.params;
        const { emoji, roomId } = req.body;
        const userId = (req as any).user.userId;
        if (!emoji || !roomId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const reaction = await addReaction(commentId, emoji, userId);
        broadcastReactionAdd(roomId, commentId, emoji, userId);
        res.status(201).json(reaction);
    } catch (error) {
        console.error('Error adding reaction:', error);
        res.status(500).json({ error: 'Failed to add reaction' });
    }
});

commentsRouter.delete('/:commentId/reactions/:emoji', async (req: Request, res: Response) => {
    try {
        const { commentId, emoji } = req.params;
        const { roomId } = req.body;
        const userId = (req as any).user.userId;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        await removeReaction(commentId, emoji, userId);
        broadcastReactionRemove(roomId, commentId, emoji, userId);
        res.status(204).send();
    } catch (error) {
        console.error('Error removing reaction:', error);
        res.status(500).json({ error: 'Failed to remove reaction' });
    }
});
}
}
}
}

app.use('/api/comments', commentsRouter);

wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room');
    const token = url.searchParams.get('token');
    let userId: string;
    if (!roomId) { ws.close(1008, 'Missing room ID'); return; }
    if (!token) { ws.close(1008, 'Missing auth token'); return; }
    const decoded = verifyWebSocketToken(token);
    if (!decoded || !decoded.userId) { ws.close(1008, 'Invalid or unauthorized auth token for room'); return; }
    userId = decoded.userId;
    console.log(`User ${userId} connected to room ${roomId}`);
    trackConnection(roomId, 'default', true);
    if (roomId) {
        if (!roomClients[roomId]) roomClients[roomId] = new Set();
        roomClients[roomId].add(ws);
    }
    let isAlive = true;
    ws.on('pong', () => { isAlive = true; });
    ws.on('message', (message: Buffer) => {
        try {
            const str = message.toString();
            if (str.startsWith('{')) {
                const data = JSON.parse(str);
                if (data.type === 'broadcast' && roomId) {
                    trackOperation(roomId, 'broadcast');
                    for (const client of roomClients[roomId]) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) client.send(message);
                    }
                    return;
                }
                if (data.type === 'create_comment' && roomId && data.blockId && data.bodyMd) {
                    trackOperation(roomId, 'create_comment');
                    createComment(roomId, data.blockId, data.bodyMd, userId, data.parentId).then(comment => broadcastComment(roomId, comment)).catch(error => { console.error(error); trackError(roomId, 'create_comment'); });
                    return;
                }
                return;
            }
            const binaryData = new Uint8Array(message);
            if (binaryData.length === 0) return;
            const messageType = binaryData[0];
            const payload = binaryData.slice(1);
            switch (messageType) {
                case MessageType.PRESENCE_DIFF: if (userId && roomId) handlePresenceDiff(roomId, userId, Buffer.from(payload)); else trackError(roomId, 'presence_diff_unauthorized'); break;
                case MessageType.STORAGE_UPDATE: if (userId && roomId) handleStorageUpdate(roomId, userId, Buffer.from(payload)); else trackError(roomId, 'storage_update_unauthorized'); break;
                case MessageType.COMMENT_ADD: handleCommentAdd(roomId, Buffer.from(payload)); break;
                case MessageType.COMMENT_EDIT: handleCommentEdit(roomId, Buffer.from(payload)); break;
                case MessageType.COMMENT_DEL: handleCommentDelete(roomId, Buffer.from(payload)); break;
                case MessageType.REACTION_ADD: handleReactionAdd(roomId, Buffer.from(payload)); break;
                case MessageType.REACTION_REMOVE: handleReactionRemove(roomId, Buffer.from(payload)); break;
                default: console.warn(`Unknown message type: ${messageType}`);
            }
        } catch (error) {
            console.error('Error processing message:', error);
            trackError(roomId, 'message_processing');
        }
    });
    ws.on('close', () => {
        console.log(`User ${userId} disconnected from room ${roomId}`);
        if (roomId && roomClients[roomId]) {
            roomClients[roomId].delete(ws);
            if (roomClients[roomId].size === 0) delete roomClients[roomId];
        }
        trackConnection(roomId, 'default', false);
    });

    function handlePresenceDiff(roomId: string, userId: string, payload: Buffer): void {
        try {
            const data = msgpack.decode(payload) as PresenceDiffMessage;
            trackOperation(roomId, 'presence_diff');
            presenceManager.updateUserPresence(roomId, userId, data.data);
            const message = Buffer.concat([Buffer.from([MessageType.PRESENCE_DIFF]), msgpack.encode({ userId, data: data.data })]);
            broadcastRaw(roomId, message, ws);
        } catch (error) {
            console.error('Error handling presence diff:', error);
            trackError(roomId, 'presence_diff');
        }
    }

    function handleStorageUpdate(roomId: string, userId: string, payload: Buffer): void {
        try {
            trackOperation(roomId, 'storage_update');
            storageEngine.applyUpdate(roomId, userId); // Pass only roomId and userId
            const message = Buffer.concat([Buffer.from([MessageType.STORAGE_UPDATE]), payload]);
            broadcastRaw(roomId, message, ws);
        } catch (error) {
            console.error('Error handling storage update:', error);
            trackError(roomId, 'storage_update');
        }
    }

    async function handleCommentAdd(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;
            const comment = await createComment(roomId, data.blockId, data.bodyMd, userId, data.parentId);
            broadcastComment(roomId, comment);
        } catch (error) {
            console.error('Error handling comment add:', error);
            trackError(roomId, 'comment_add');
        }
    }

    async function handleCommentEdit(roomId: string, payload: Buffer): Promise<void> {
        console.warn('Comment edit not yet implemented');
    }

    async function handleCommentDelete(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;
            await deleteComment(data.id, userId);
            broadcastCommentDeletion(roomId, data.id);
        } catch (error) {
            console.error('Error handling comment delete:', error);
            trackError(roomId, 'comment_delete');
        }
    }

    async function handleReactionAdd(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;
            const reaction = await addReaction(data.commentId, data.emoji, userId);
            broadcastReactionAdd(roomId, data.commentId, data.emoji, userId);
        } catch (error) {
            console.error('Error handling reaction add:', error);
            trackError(roomId, 'reaction_add');
        }
    }

    async function handleReactionRemove(roomId: string, payload: Buffer): Promise<void> {
        try {
            const data = msgpack.decode(payload) as any;
            await removeReaction(data.commentId, data.emoji, userId);
            broadcastReactionRemove(roomId, data.commentId, data.emoji, userId);
        } catch (error) {
            console.error('Error handling reaction remove:', error);
            trackError(roomId, 'reaction_remove');
        }
    }

    function broadcastRaw(roomId: string, message: Buffer, excludeWs: WebSocket) {
        if (roomClients[roomId]) {
            for (const client of roomClients[roomId]) {
                if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            }
        }
    }

    function broadcastComment(roomId: string, comment: any) {
        if (roomClients[roomId]) {
            for (const client of roomClients[roomId]) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'new_comment', comment }));
                }
            }
        }
    }

    function broadcastCommentDeletion(roomId: string, commentId: string) {
        if (roomClients[roomId]) {
            for (const client of roomClients[roomId]) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'delete_comment', commentId }));
                }
            }
        }
    }

    function broadcastReactionAdd(roomId: string, commentId: string, emoji: string, userId: string) {
        if (roomClients[roomId]) {
            for (const client of roomClients[roomId]) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'add_reaction', commentId, emoji, userId }));
                }
            }
        }
    }

    function broadcastReactionRemove(roomId: string, commentId: string, emoji: string, userId: string) {
        if (roomClients[roomId]) {
            for (const client of roomClients[roomId]) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'remove_reaction', commentId, emoji, userId }));
                }
            }
        }
    }