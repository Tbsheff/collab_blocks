import { RoomDO } from './room_do';

export { RoomDO };

/**
 * Edge Worker
 * Routes requests to appropriate Durable Object
 */
export default {
    async fetch(request: Request, env: any): Promise<Response> {
        const url = new URL(request.url);

        // WebSocket endpoint
        if (url.pathname === '/ws') {
            return handleWebSocket(request, env);
        }

        // Health check
        if (url.pathname === '/health') {
            return new Response('OK', { status: 200 });
        }

        return new Response('Not found', { status: 404 });
    },
};

/**
 * Handle WebSocket requests by forwarding to Room DO
 */
async function handleWebSocket(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room');

    if (!roomId) {
        return new Response('Missing room ID', { status: 400 });
    }

    // Get or create Durable Object for this room
    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);

    // Forward the request to the Durable Object
    return stub.fetch(request);
} 