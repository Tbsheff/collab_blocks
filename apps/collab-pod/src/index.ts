import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { PresenceManager } from './presence/manager';
import { StorageEngine } from './storage/engine';
import { MessageType, msgpack } from '@collabblocks/protocol';

// Create Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Create managers
const presenceManager = new PresenceManager();
const storageEngine = new StorageEngine();

// Basic health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

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

    // Handle pings to keep connection alive
    ws.on('pong', () => {
        isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', (message: Buffer) => {
        try {
            // First byte is message type
            const messageType = message[0];
            const payload = message.slice(1);

            switch (messageType) {
                case MessageType.PRESENCE_DIFF:
                    handlePresenceDiff(roomId || '', userId, payload);
                    break;

                case MessageType.STORAGE_UPDATE:
                    handleStorageUpdate(roomId || '', userId, payload);
                    break;

                default:
                    console.warn(`Unknown message type: ${messageType}`);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    // Handle connection close
    ws.on('close', () => {
        console.log(`User ${userId} disconnected from room ${roomId}`);
        if (roomId) {
            presenceManager.removeUser(roomId, userId);
        }
        isAlive = false;
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
            const diff = msgpack.decode(payload) as Record<string, any>;

            // Update presence state
            presenceManager.applyDiff(roomId, userId, diff);

            // Broadcast to all clients in the room
            broadcast(roomId, {
                type: MessageType.PRESENCE_DIFF,
                userId,
                data: diff
            }, ws);
        } catch (error) {
            console.error('Error handling presence diff:', error);
        }
    }

    // Helper function for handling storage updates
    function handleStorageUpdate(roomId: string, userId: string, payload: Buffer): void {
        try {
            // Apply update to storage engine
            const mergedUpdate = storageEngine.applyUpdate(roomId, new Uint8Array(payload));

            // Broadcast to all clients in the room
            const message = Buffer.concat([
                Buffer.from([MessageType.STORAGE_UPDATE]),
                Buffer.from(mergedUpdate)
            ]);

            broadcastRaw(roomId, message, ws);
        } catch (error) {
            console.error('Error handling storage update:', error);
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

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 