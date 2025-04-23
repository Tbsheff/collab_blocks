import { createContext, useContext, useEffect, useState } from 'react';

// Define enums and types from protocol
export enum MessageType {
    PRESENCE_DIFF = 0x01,
    STORAGE_UPDATE = 0x02,
    COMMENT_ADD = 0x03,
    COMMENT_EDIT = 0x04,
    COMMENT_DEL = 0x05,
    REACTION_ADD = 0x06,
    REACTION_REMOVE = 0x07,
}

export interface PresenceDiffMessage {
    type: number;
    userId: string;
    data: Record<string, any>;
}

export interface StorageUpdateMessage {
    type: number;
    update: Uint8Array;
}

// Simple msgpack-like implementation for encoding/decoding
export const msgpack = {
    encode: (data: any): Uint8Array => {
        // Use JSON for simplicity - in a real implementation, use a proper msgpack library
        const str = JSON.stringify(data);
        const encoder = new TextEncoder();
        return encoder.encode(str);
    },
    decode: (data: Uint8Array): any => {
        // Use JSON for simplicity - in a real implementation, use a proper msgpack library
        const decoder = new TextDecoder();
        const str = decoder.decode(data);
        return JSON.parse(str);
    }
};

// Event emitter interface
type Listener = (...args: any[]) => void;

interface EventEmitter {
    on(event: string, listener: Listener): void;
    off(event: string, listener: Listener): void;
    emit(event: string, ...args: any[]): void;
}

/**
 * Connection manager that handles WebSocket communication
 */
export class Connection implements EventEmitter {
    private ws: WebSocket | null = null;

    // Make url and room public so they can be accessed
    public url: string;
    public room: string;

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
                        const diff = msgpack.decode(payload) as PresenceDiffMessage;
                        this.emit('presence', diff.userId, diff.data);
                        break;
                    }

                    case MessageType.STORAGE_UPDATE: {
                        const updateMsg = msgpack.decode(payload) as StorageUpdateMessage;
                        this.emit('storageUpdate', updateMsg.update);
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
     * Send JSON data over WebSocket
     */
    sendJson(data: any): void {
        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Register event listener
     */
    on(event: string, listener: Listener): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }

    /**
     * Remove event listener
     */
    off(event: string, listener: Listener): void {
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