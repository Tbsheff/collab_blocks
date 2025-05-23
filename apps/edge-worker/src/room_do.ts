import { MessageType, msgpack } from '@collabblocks/protocol';
import type { PresenceDiffMessage, StorageUpdateMessage } from '@collabblocks/protocol';
import { verify, verifyWebSocketToken } from '@collabblocks/auth';

export interface RoomState {
    connections: Map<string, WebSocket>;
    podUrl: string;
}

// Local interface for decoded token
interface DecodedToken {
    userId: string;
    role?: string;
    rooms?: string[];
    [key: string]: any;
}

// Connection details interface for keeping track of authenticated connections
interface ConnectionDetails {
    userId: string;
    ws: WebSocket;
    connectionId: string;
}

/**
 * Room Durable Object
 * Handles WebSocket connections and routes messages to the collab pod
 */
export class RoomDO {
    private state: DurableObjectState;
    private roomState: RoomState = {
        connections: new Map(),
        podUrl: 'http://localhost:8080', // Default for dev
    };

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
    }

    /**
     * Handle HTTP request
     */
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // WebSocket upgrade
        if (request.headers.get('Upgrade') === 'websocket') {
            return this.handleWebSocket(request);
        }

        // Health check
        if (url.pathname === '/health') {
            return new Response('OK', { status: 200 });
        }

        return new Response('Not found', { status: 404 });
    }

    /**
     * Handle WebSocket upgrade
     */
    async handleWebSocket(request: Request): Promise<Response> {
        // Parse URL query parameters
        const url = new URL(request.url);
        const roomId = url.searchParams.get('room');
        const token = url.searchParams.get('token');

        // Validate room and token
        if (!roomId) {
            return new Response('Missing room ID', { status: 400 });
        }

        if (!token) {
            return new Response('Missing auth token', { status: 401 });
        }

        // Validate token using auth package
        let decodedToken: DecodedToken | null;
        try {
            // Use the verifyWebSocketToken method for better error handling
            decodedToken = verifyWebSocketToken(token);
            if (!decodedToken) {
                throw new Error('Invalid token format');
            }

            // Ensure the token has a userId
            if (!decodedToken.userId) {
                throw new Error('userId missing in token');
            }

            // Optional: Check if the token has permission for this room
            // if (!decodedToken.rooms || !decodedToken.rooms.includes(roomId)) {
            //    throw new Error('User not authorized for this room');
            // }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Invalid auth token';
            return new Response(`Authentication failed: ${errorMessage}`, { status: 401 });
        }

        // Extract userId from the verified token
        const userId = decodedToken.userId;

        // Set up WebSocket
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        // Configure WebSocket
        server.accept();

        // Add to connection pool with unique ID
        const connectionId = `${userId}_${Date.now()}`;
        this.roomState.connections.set(connectionId, server);

        // Send initial state
        this.sendPresenceList(server);

        // Set up message handler
        server.addEventListener('message', async event => {
            try {
                const data = new Uint8Array(event.data as ArrayBuffer);
                const messageType = data[0];
                const payload = data.slice(1);

                // Process message based on type
                switch (messageType) {
                    case MessageType.PRESENCE_DIFF:
                        this.handlePresenceDiff(userId, server, payload);
                        break;

                    case MessageType.STORAGE_UPDATE:
                        this.handleStorageUpdate(userId, server, payload);
                        break;

                    default:
                        console.warn(`Unknown message type: ${messageType}`);
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        });

        // Handle connection close
        server.addEventListener('close', () => {
            this.roomState.connections.delete(connectionId);

            // Notify other clients
            this.broadcastUserLeft(userId);
        });

        // Handle errors
        server.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
            this.roomState.connections.delete(connectionId);
        });

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    /**
     * Send presence list to a new connection
     */
    private sendPresenceList(client: WebSocket): void {
        // TODO: Implement full sync
        // For MVP, just send an empty presence list
        const presenceList: any[] = [];
        client.send(JSON.stringify({ type: 'presence_sync', presenceList }));
    }

    /**
     * Handle presence update
     */
    private handlePresenceDiff(userId: string, connectionId: WebSocket, payload: Uint8Array): void {
        try {
            const diff = msgpack.decode(payload);

            // Broadcast to all other connections
            const message = new Uint8Array([
                MessageType.PRESENCE_DIFF,
                ...msgpack.encode({
                    type: MessageType.PRESENCE_DIFF,
                    userId,
                    data: diff.data,
                })
            ]);

            this.broadcast(message, connectionId);

            // TODO: Forward to collab pod for persistence
        } catch (error) {
            console.error('Presence diff error:', error);
        }
    }

    /**
     * Handle storage update
     */
    private handleStorageUpdate(userId: string, connectionId: WebSocket, payload: Uint8Array): void {
        try {
            // Broadcast storage update to all connections
            const message = new Uint8Array([
                MessageType.STORAGE_UPDATE,
                ...msgpack.encode({
                    type: MessageType.STORAGE_UPDATE,
                    update: payload,
                })
            ]);

            this.broadcast(message, connectionId);

            // TODO: Forward to collab pod for persistence
        } catch (error) {
            console.error('Storage update error:', error);
        }
    }

    /**
     * Broadcast a message to all connections except the sender
     */
    private broadcast(message: Uint8Array, excludeId?: WebSocket): void {
        for (const [id, ws] of this.roomState.connections) {
            if (ws !== excludeId && ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    /**
     * Broadcast user left notification
     */
    private broadcastUserLeft(userId: string): void {
        // TODO: Implement user left notification
    }
} 