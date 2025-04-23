import { createContext, useContext, useEffect, useState } from 'react';
import { MessageType, msgpack } from '@collabblocks/protocol';

// Event emitter interface
type Listener<T = any> = (data: T, ...args: any[]) => void;

interface EventEmitter {
    on<T = any>(event: string, listener: Listener<T>): void;
    off<T = any>(event: string, listener: Listener<T>): void;
    emit(event: string, ...args: any[]): void;
}

/**
 * Connection manager that handles WebSocket communication
 */
export class Connection implements EventEmitter {
    private ws: WebSocket | null = null;
    private url: string;
    private room: string;
    private token: string;
    private listeners: Record<string, Listener[]> = {};
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Whether the connection is currently established
     */
    isConnected = false;

    constructor(url: string, room: string, token: string) {
        this.url = url;
        this.room = room;
        this.token = token;
        this.connect();
    }

    /**
     * Connect to the WebSocket server
     */
    private connect(): void {
        if (this.ws) {
            this.ws.close();
        }

        // Add auth and room info to URL
        const wsUrl = `${this.url}/ws?room=${this.room}&token=${this.token}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');
        };

        this.ws.onclose = () => {
            this.isConnected = false;
            this.emit('disconnected');
            this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
            this.emit('error', error);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = new Uint8Array(event.data as ArrayBuffer);

                // First byte is the message type
                const messageType = data[0];

                // Payload starts at index 1
                const payload = data.slice(1);

                switch (messageType) {
                    case MessageType.PRESENCE_DIFF: {
                        const diff = msgpack.decode(payload) as { userId: string; data: any };
                        this.emit('presence', diff.userId, diff.data);
                        break;
                    }

                    case MessageType.STORAGE_UPDATE: {
                        this.emit('storageUpdate', payload);
                        break;
                    }

                    default:
                        this.emit('unknown', data);
                        break;
                }
            } catch (error) {
                console.error('Failed to process message', error);
            }
        };
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
        }, delay);
    }

    /**
     * Send data over WebSocket
     */
    send(data: Uint8Array): void {
        if (this.ws && this.isConnected) {
            this.ws.send(data);
        }
    }

    /**
     * Register event listener
     */
    on<T = any>(event: string, listener: Listener<T>): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener as Listener);
    }

    /**
     * Remove event listener
     */
    off<T = any>(event: string, listener: Listener<T>): void {
        if (!this.listeners[event]) return;

        this.listeners[event] = this.listeners[event].filter(l => l !== listener);
    }

    /**
     * Emit event to listeners
     */
    emit(event: string, ...args: any[]): void {
        const listeners = this.listeners[event];
        if (!listeners) return;

        for (const listener of listeners) {
            listener(...args);
        }
    }

    /**
     * Close the WebSocket connection
     */
    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// React context for the connection
const ConnectionContext = createContext<Connection | null>(null);

export const ConnectionProvider = ConnectionContext.Provider;

/**
 * Hook to access the current connection
 */
export function useConnection(): Connection | null {
    return useContext(ConnectionContext);
}

/**
 * Hook to create and manage a connection
 */
export function useCreateConnection(url: string, room: string, token: string) {
    const [connection, setConnection] = useState<Connection | null>(null);

    useEffect(() => {
        const conn = new Connection(url, room, token);
        setConnection(conn);

        return () => {
            conn.disconnect();
        };
    }, [url, room, token]);

    return connection;
} 