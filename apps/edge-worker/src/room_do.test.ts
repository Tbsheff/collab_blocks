import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomDO } from './room_do';

// Mock dependencies
vi.mock('@collabblocks/auth', () => ({
    verify: vi.fn()
}));

vi.mock('@collabblocks/protocol', () => ({
    MessageType: {
        PRESENCE_DIFF: 1,
        STORAGE_UPDATE: 2
    },
    msgpack: {
        encode: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
        decode: vi.fn().mockReturnValue({ data: {} })
    }
}));

import { verify } from '@collabblocks/auth';

// Define WebSocket constants since WebSocket is not available in Node environment
const WS_OPEN = 1;
const WS_CLOSED = 3;

// Mock WebSocketPair for testing
class MockWebSocket {
    onmessage: ((event: any) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: any) => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = WS_OPEN;
    sent: any[] = [];

    addEventListener(event: string, listener: any) {
        if (event === 'message') this.onmessage = listener;
        if (event === 'close') this.onclose = listener;
        if (event === 'error') this.onerror = listener;
    }

    send(data: any) {
        this.sent.push(data);
    }

    close() {
        this.readyState = WS_CLOSED;
        if (this.onclose) this.onclose();
    }

    accept() {
        // Simulate accept behavior
        if (this.onopen) this.onopen();
    }
}

class MockWebSocketPair {
    client: MockWebSocket;
    server: MockWebSocket;

    constructor() {
        this.client = new MockWebSocket();
        this.server = new MockWebSocket();
    }
}

// Mock global WebSocketPair
(global as any).WebSocketPair = function () {
    const pair = new MockWebSocketPair();
    return [pair.client, pair.server];
};

// Mock DurableObjectState
const mockState = {
    storage: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
    blockConcurrencyWhile: vi.fn().mockImplementation(async (func) => {
        return await func();
    }),
};

// Also mock WebSocket for the broadcast method
(global as any).WebSocket = {
    OPEN: WS_OPEN,
    CLOSED: WS_CLOSED
};

describe('RoomDO', () => {
    let roomDO: RoomDO;

    beforeEach(() => {
        vi.resetAllMocks();
        roomDO = new RoomDO(mockState as any, {});
    });

    describe('handleWebSocket', () => {
        it('rejects connections without a room ID', async () => {
            const request = new Request('https://example.com/ws?token=validtoken');
            const response = await roomDO.handleWebSocket(request);
            expect(response.status).toBe(400);
            expect(await response.text()).toBe('Missing room ID');
        });

        it('rejects connections without an auth token', async () => {
            const request = new Request('https://example.com/ws?room=room1');
            const response = await roomDO.handleWebSocket(request);
            expect(response.status).toBe(401);
            expect(await response.text()).toBe('Missing auth token');
        });

        it('rejects connections with invalid JWT tokens', async () => {
            // Mock verify to throw an error
            (verify as any).mockImplementation(() => {
                throw new Error('Invalid token');
            });

            const request = new Request('https://example.com/ws?room=room1&token=invalidtoken');
            const response = await roomDO.handleWebSocket(request);
            expect(response.status).toBe(401);
            expect(await response.text()).toBe('Invalid auth token');
        });

        it('accepts connections with valid tokens and adds to connection pool', async () => {
            // Mock verify to return a valid user
            (verify as any).mockReturnValue({ userId: 'test-user-123' });

            const request = new Request('https://example.com/ws?room=room1&token=validtoken');

            // Mock the Response constructor to accept status 101
            const originalResponse = global.Response;
            global.Response = function (body?: BodyInit | null, init?: ResponseInit) {
                return { status: init?.status || 200, body, headers: new Headers(init?.headers) };
            } as any;

            try {
                const response = await roomDO.handleWebSocket(request);

                expect(response.status).toBe(101); // WebSocket handshake
                expect(verify).toHaveBeenCalledWith('validtoken');

                // Check that a connection was added to the room
                expect(roomDO['roomState'].connections.size).toBe(1);
            } finally {
                global.Response = originalResponse;
            }
        });
    });
}); 