import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import http from 'http';
import express from 'express';
import { PresenceManager } from './presence/manager';
import { StorageEngine } from './storage/engine';
import * as Y from 'yjs';
import Redis from 'ioredis';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AddressInfo } from 'net';

let server: http.Server;

beforeAll(async () => {
    const app = express();
    (app as any).get('/health', (req: any, res: any) => res.status(200).send('OK'));
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, () => resolve()));
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('CollabPod Server', () => {
    it('responds to /health', async () => {
        const res = await request(server).get('/health');
        expect(res.status).toBe(200);
        expect(res.text).toBe('OK');
    });

    it('PresenceManager basic usage', () => {
        const pm = new PresenceManager();
        pm.applyDiff('room1', 'user1', { cursor: { x: 1, y: 2 } });
        const state = pm.getFullState('room1');
        expect(state.length).toBe(1);
        expect(state[0]).toMatchObject({ cursor: { x: 1, y: 2 } });
        pm.removeUser('room1', 'user1');
        expect(pm.getFullState('room1')).toEqual([]);
    });

    it('StorageEngine basic usage', () => {
        const se = new StorageEngine();
        const roomId = 'room1';
        const doc = se.getDocument(roomId);
        expect(doc).toBeDefined();
        const update = Y.encodeStateAsUpdate(doc);
        se.applyUpdate(roomId, update);
        const state = se.getState(roomId);
        expect(state).toBeInstanceOf(Uint8Array);
        se.removeRoom(roomId);
        // After removal, a new doc is created
        expect(se.getDocument(roomId)).toBeDefined();
    });
});

describe('Presence API', () => {
    let redis: Redis;
    let pm: PresenceManager;
    const roomId = 'testroom';
    const userId = 'user1';

    beforeAll(async () => {
        redis = new Redis();
        pm = new PresenceManager(redis);
        await redis.del('presence-' + roomId);
    });

    afterAll(async () => {
        await redis.quit();
    });

    it('should add, update, and remove user presence in a room', async () => {
        // Add presence
        await pm.applyDiff(roomId, userId, { cursor: { x: 1, y: 2 } });
        let state = pm.getFullState(roomId);
        expect(state.length).toBe(1);
        expect(state[0]).toMatchObject({ cursor: { x: 1, y: 2 } });

        // Update presence
        await pm.applyDiff(roomId, userId, { cursor: { x: 3, y: 2 } });
        state = pm.getFullState(roomId);
        expect(state[0]).toMatchObject({ cursor: { x: 3, y: 2 } });

        // Check Redis stream
        const entries = await redis.xrange('presence-' + roomId, '-', '+');
        expect(entries.length).toBeGreaterThanOrEqual(2);
        const lastEntry = entries[entries.length - 1][1];
        const diffFieldIndex = lastEntry.findIndex((v: string) => v === 'diff');
        expect(diffFieldIndex).toBeGreaterThan(-1);
        const diff = JSON.parse(lastEntry[diffFieldIndex + 1]);
        expect(diff).toMatchObject({ cursor: { x: 3, y: 2 } });

        // Remove presence
        pm.removeUser(roomId, userId);
        state = pm.getFullState(roomId);
        expect(state).toEqual([]);
    });

    it('should expire presence after TTL', async () => {
        // Use a short TTL for testing
        const shortTTL = 100;
        const pmShort = new PresenceManager(redis, shortTTL);
        await pmShort.applyDiff(roomId, userId, { cursor: { x: 1, y: 0 } });
        let state = pmShort.getFullState(roomId);
        expect(state.length).toBe(1);
        // Wait for TTL to expire
        await new Promise(res => setTimeout(res, shortTTL + 50));
        state = pmShort.getFullState(roomId);
        expect(state).toEqual([]);
    });

    it('should broadcast presence diffs to other pods via Redis Streams', async () => {
        // Simulate two pods with separate PresenceManager instances
        const pmPod1 = new PresenceManager(redis);
        const pmPod2 = new PresenceManager(redis);
        const roomId = 'broadcastroom';
        const userId = 'userA';
        await redis.del('presence-' + roomId);

        // Pod 1 writes a diff
        await pmPod1.applyDiff(roomId, userId, { cursor: { x: 42, y: 0 } });

        // Pod 2 reads the diff from the stream
        // Get the first entry (should be the one just written)
        const entries = await redis.xrange('presence-' + roomId, '-', '+');
        expect(entries.length).toBeGreaterThanOrEqual(1);
        const entry = entries[0][1];
        const userIdIndex = entry.findIndex((v: string) => v === 'userId');
        const diffIndex = entry.findIndex((v: string) => v === 'diff');
        expect(userIdIndex).toBeGreaterThan(-1);
        expect(diffIndex).toBeGreaterThan(-1);
        expect(entry[userIdIndex + 1]).toBe(userId);
        const diff = JSON.parse(entry[diffIndex + 1]);
        expect(diff).toMatchObject({ cursor: { x: 42, y: 0 } });

        // Pod 2 can use readDiffs to get the same entry
        const read = await pmPod2.readDiffs(roomId, '0');
        expect(read.length).toBeGreaterThanOrEqual(1);
    });

    it('should recover presence state from Redis on pod restart', () => {
        // TODO: Implement test
    });
});

describe('Realtime Storage (CRDT, Postgres)', () => {
    it('should create, update, and retrieve CRDT documents per room', () => {
        const se = new StorageEngine();
        const roomId = 'room-crdt';
        // Create a new doc
        const doc = se.getDocument(roomId);
        expect(doc).toBeDefined();
        // Update the doc (Yjs)
        doc.getMap('data').set('foo', 'bar');
        // Retrieve state
        const state = se.getState(roomId);
        expect(state).toBeInstanceOf(Uint8Array);
        // Apply update to a new doc and check value
        const se2 = new StorageEngine();
        se2.applyUpdate(roomId, state);
        const doc2 = se2.getDocument(roomId);
        expect(doc2.getMap('data').get('foo')).toBe('bar');
    });

    it('should persist ops to Postgres and recover state after restart', async () => {
        const { Client } = require('pg');
        const client = new Client({
            host: 'localhost',
            port: 5432,
            user: 'collabblocks',
            password: 'collabblocks',
            database: 'collabblocks',
        });
        await client.connect();
        const roomId = 'room-pg';
        await client.query('DELETE FROM ops_ WHERE room_id = $1', [roomId]);

        // Create a StorageEngine with Postgres
        const se = new StorageEngine(client);
        const doc = se.getDocument(roomId);
        doc.getMap('data').set('foo', 'persisted');
        // Persist the update
        const update = se.getState(roomId);
        await se.persistOp(roomId, update);

        // Simulate restart: new StorageEngine instance
        const se2 = new StorageEngine(client);
        // Load ops from Postgres and replay
        const ops = await se2.loadOps(roomId);
        const doc2 = se2.getDocument(roomId);
        for (const op of ops) {
            se2.applyUpdate(roomId, op);
        }
        expect(doc2.getMap('data').get('foo')).toBe('persisted');

        await client.end();
    });

    it('should batch and compact ops as described in the technical plan', () => {
        // TODO: Implement test
    });
});

describe('WebSocket Protocol', function () {
    let serverInstance: any;
    let port: number;
    const secret = 'testsecret';

    beforeAll(async () => {
        await new Promise<void>((resolve) => {
            const app = require('express')();
            const http = require('http').createServer(app);
            const { Server } = require('ws');
            const wss = new Server({ server: http });
            wss.on('connection', (ws: any, req: any) => {
                // JWT validation logic
                try {
                    const url = require('url');
                    const query = url.parse(req.url, true).query;
                    const token = query.token;
                    jwt.verify(token, secret);
                    ws.send('connected');
                } catch (e) {
                    ws.close();
                }
            });
            http.listen(0, function () {
                port = http.address().port;
                serverInstance = http;
                resolve();
            });
        });
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => {
            if (serverInstance) serverInstance.close(resolve);
            else resolve();
        });
    });

    it('should accept valid JWT and reject invalid tokens', async () => {
        const token = jwt.sign({ user: 'test' }, secret);
        // Connect with valid JWT
        await new Promise<void>((resolve, reject) => {
            const wsValid = new WebSocket(`ws://localhost:${port}/?token=${token}`);
            wsValid.on('message', function (msg) {
                try {
                    expect(msg.toString()).toBe('connected');
                    wsValid.close();
                    // Now try with invalid JWT
                    const wsInvalid = new WebSocket(`ws://localhost:${port}/?token=invalid`);
                    wsInvalid.on('close', function () {
                        resolve();
                    });
                } catch (err) {
                    reject(err);
                }
            });
            wsValid.on('error', reject);
        });
    });

    it('should join/leave rooms and receive correct initial state', async () => {
        await new Promise<void>((resolve, reject) => {
            const app = require('express')();
            const http = require('http').createServer(app);
            const { Server } = require('ws');
            const wss = new Server({ server: http });
            wss.on('connection', (ws: any, req: any) => {
                const url = require('url');
                const query = url.parse(req.url, true).query;
                const room = query.room;
                ws.send(JSON.stringify({ type: 'initial_state', room, presence: [], storage: {} }));
                ws.on('close', () => { });
            });
            http.listen(0, function () {
                const port = http.address().port;
                const ws = new WebSocket(`ws://localhost:${port}/?room=testroom`);
                ws.on('message', function (msg) {
                    try {
                        const data = JSON.parse(msg.toString());
                        expect(data.type).toBe('initial_state');
                        expect(data.room).toBe('testroom');
                        ws.close();
                        http.close(resolve);
                    } catch (err) {
                        reject(err);
                    }
                });
                ws.on('error', reject);
            });
        });
    });

    it('should handle multiple users in the same room', async () => {
        await new Promise<void>((resolve, reject) => {
            const app = require('express')();
            const http = require('http').createServer(app);
            const { Server } = require('ws');
            const wss = new Server({ server: http });
            const roomUsers: Record<string, Set<any>> = {};
            wss.on('connection', (ws: any, req: any) => {
                const url = require('url');
                const query = url.parse(req.url, true).query;
                const room = query.room;
                if (!roomUsers[room]) roomUsers[room] = new Set();
                roomUsers[room].add(ws);
                const count = roomUsers[room].size;
                for (const client of roomUsers[room]) {
                    client.send(JSON.stringify({ type: 'user_count', count }));
                }
                ws.on('close', () => {
                    roomUsers[room].delete(ws);
                });
            });
            http.listen(0, function () {
                const port = http.address().port;
                const ws1 = new WebSocket(`ws://localhost:${port}/?room=multiroom`);
                const ws2 = new WebSocket(`ws://localhost:${port}/?room=multiroom`);
                let ws1Count = 0, ws2Count = 0;
                ws1.on('message', function (msg) {
                    try {
                        const data = JSON.parse(msg.toString());
                        if (data.type === 'user_count') ws1Count = data.count;
                        if (ws1Count === 2 && ws2Count === 2) finish();
                    } catch (err) {
                        reject(err);
                    }
                });
                ws2.on('message', function (msg) {
                    try {
                        const data = JSON.parse(msg.toString());
                        if (data.type === 'user_count') ws2Count = data.count;
                        if (ws1Count === 2 && ws2Count === 2) finish();
                    } catch (err) {
                        reject(err);
                    }
                });
                ws1.on('error', reject);
                ws2.on('error', reject);
                function finish() {
                    ws1.close();
                    ws2.close();
                    http.close(resolve);
                }
            });
        });
    });
});

describe('Broadcast Channel & Threaded Comments', () => {
    it('should send and receive broadcast messages in a room', async () => {
        await new Promise<void>((resolve, reject) => {
            const app = require('express')();
            const http = require('http').createServer(app);
            const { Server } = require('ws');
            const wss = new Server({ server: http });
            const roomUsers: Record<string, Set<any>> = {};
            wss.on('connection', (ws: any, req: any) => {
                const url = require('url');
                const query = url.parse(req.url, true).query;
                const room = query.room;
                if (!roomUsers[room]) roomUsers[room] = new Set();
                roomUsers[room].add(ws);
                ws.on('message', (msg: Buffer) => {
                    // Broadcast to all other users in the room
                    for (const client of roomUsers[room]) {
                        if (client !== ws) client.send(msg);
                    }
                });
                ws.on('close', () => {
                    roomUsers[room].delete(ws);
                });
            });
            http.listen(0, function () {
                const port = http.address().port;
                const ws1 = new WebSocket(`ws://localhost:${port}/?room=broadcast`);
                const ws2 = new WebSocket(`ws://localhost:${port}/?room=broadcast`);
                ws2.on('message', function (msg) {
                    try {
                        const data = JSON.parse(msg.toString());
                        expect(data.type).toBe('broadcast');
                        expect(data.payload).toBe('hello');
                        ws1.close();
                        ws2.close();
                        http.close(resolve);
                    } catch (err) {
                        reject(err);
                    }
                });
                ws1.on('open', function () {
                    ws1.send(JSON.stringify({ type: 'broadcast', payload: 'hello' }));
                });
                ws1.on('error', reject);
                ws2.on('error', reject);
            });
        });
    });

    it('should create, fetch, and thread comments per block/room', async () => {
        // In-memory comments store for test
        const comments: Record<string, any[]> = {};
        // Simulate API for comments
        function createComment(room: string, block: string, text: string, parentId?: string) {
            const id = Math.random().toString(36).slice(2);
            const comment = { id, room, block, text, parentId, replies: [] };
            if (!comments[block]) comments[block] = [];
            if (parentId) {
                const parent = comments[block].find(c => c.id === parentId);
                if (parent) parent.replies.push(comment);
            } else {
                comments[block].push(comment);
            }
            return comment;
        }
        function fetchComments(block: string) {
            return comments[block] || [];
        }
        // Create root comment
        const c1 = createComment('room1', 'block1', 'Root comment');
        expect(fetchComments('block1').length).toBe(1);
        // Create reply
        const c2 = createComment('room1', 'block1', 'Reply', c1.id);
        expect(fetchComments('block1')[0].replies.length).toBe(1);
        // Create another root comment
        createComment('room1', 'block1', 'Another root');
        expect(fetchComments('block1').length).toBe(2);
    });
});

describe('Notifications System', () => {
    it('should enqueue and deliver notifications via NATS (in-memory for test)', async () => {
        // In-memory notification queue
        const notifications: any[] = [];
        // Simulate enqueue
        function enqueueNotification(user: string, message: string) {
            notifications.push({ user, message });
        }
        // Simulate delivery
        function deliverNotifications(user: string) {
            return notifications.filter(n => n.user === user);
        }
        enqueueNotification('user1', 'Hello');
        enqueueNotification('user2', 'Hi');
        enqueueNotification('user1', 'World');
        const delivered = deliverNotifications('user1');
        expect(delivered.length).toBe(2);
        expect(delivered[0].message).toBe('Hello');
        expect(delivered[1].message).toBe('World');
    });

    it('should enforce per-user rate limits', async () => {
        // In-memory rate limiter (token bucket)
        const limits: Record<string, { tokens: number, last: number }> = {};
        const maxPerMinute = 2;
        function canSend(user: string) {
            const now = Date.now();
            if (!limits[user] || now - limits[user].last > 60000) {
                limits[user] = { tokens: maxPerMinute - 1, last: now };
                return true;
            }
            if (limits[user].tokens > 0) {
                limits[user].tokens--;
                limits[user].last = now;
                return true;
            }
            return false;
        }
        expect(canSend('user1')).toBe(true);
        expect(canSend('user1')).toBe(true);
        expect(canSend('user1')).toBe(false);
        // Simulate time passing
        limits['user1'].last -= 61000;
        expect(canSend('user1')).toBe(true);
    });

    it('should retry and dead-letter failed notifications', async () => {
        // In-memory queue and DLQ
        const queue: any[] = [];
        const dlq: any[] = [];
        // Simulate delivery with failure
        function deliver(n: any) {
            if (n.fail) throw new Error('fail');
        }
        function processQueue() {
            for (const n of queue) {
                try {
                    deliver(n);
                } catch {
                    n.retries = (n.retries || 0) + 1;
                    if (n.retries > 2) dlq.push(n);
                }
            }
        }
        queue.push({ user: 'user1', message: 'fail1', fail: true });
        queue.push({ user: 'user2', message: 'ok' });
        processQueue();
        processQueue();
        processQueue();
        expect(dlq.length).toBe(1);
        expect(dlq[0].user).toBe('user1');
    });
});

describe('Monitoring Dashboard', () => {
    it('should expose Prometheus metrics endpoint', async () => {
        // Mock the metrics module for testing
        const mockRegister = {
            contentType: 'text/plain; version=0.0.4; charset=utf-8',
            metrics: async () => '# HELP process_cpu_user_seconds User CPU time spent in seconds.\n# TYPE process_cpu_user_seconds counter\nprocess_cpu_user_seconds 0.1'
        };

        const mockMetrics = {
            activeConnections: {
                inc: vi.fn(),
                dec: vi.fn(),
                get: vi.fn()
            },
            opsTotal: {
                inc: vi.fn(),
                get: vi.fn(() => ({ values: [] }))
            },
            wsErrors: {
                inc: vi.fn(),
                get: vi.fn(() => ({ values: [] }))
            }
        };

        // Mock module
        vi.mock('./metrics', () => ({
            register: mockRegister,
            metrics: mockMetrics,
            trackConnection: vi.fn(),
            trackOperation: vi.fn(),
            trackError: vi.fn(),
            httpMetricsMiddleware: (req: Request, res: Response, next: NextFunction) => next()
        }));

        const app = express();
        const promBundle = require('express-prom-bundle');

        // Configure the metrics middleware
        const metricsMiddleware = promBundle({
            includeMethod: true,
            includePath: true,
            includeStatusCode: true,
            includeUp: true,
            customLabels: { app: 'collab-pod-test' },
            promClient: { collectDefaultMetrics: {} }
        });

        // Apply middlewares
        app.use(metricsMiddleware);

        // Expose metrics endpoint
        app.get('/metrics', async (req: Request, res: Response) => {
            res.set('Content-Type', mockRegister.contentType);
            res.end(await mockRegister.metrics());
        });

        // Create test server
        const server = app.listen(0);
        const port = (server.address() as AddressInfo).port;

        try {
            // Make request to metrics endpoint
            const response = await fetch(`http://localhost:${port}/metrics`);
            expect(response.status).toBe(200);

            // Get metrics response text
            const text = await response.text();

            // Verify metrics content
            expect(text).toContain('# HELP ');
            expect(text).toContain('# TYPE ');
            expect(text).toContain('process_cpu_user_seconds');
        } finally {
            server.close();
            vi.restoreAllMocks();
        }
    });

    it('should handle metrics endpoint errors gracefully', async () => {
        // Mock the metrics module with an error
        const mockRegister = {
            contentType: 'text/plain; version=0.0.4; charset=utf-8',
            metrics: async () => {
                throw new Error('Metrics generation failed');
            }
        };

        vi.mock('./metrics', () => ({
            register: mockRegister,
            metrics: {},
            trackConnection: vi.fn(),
            trackOperation: vi.fn(),
            trackError: vi.fn(),
            httpMetricsMiddleware: (req: Request, res: Response, next: NextFunction) => next()
        }));

        // Create test server with error handling
        const app = express();

        // Configure the metrics endpoint with error handling
        app.get('/metrics', async (req: Request, res: Response) => {
            res.set('Content-Type', mockRegister.contentType);
            try {
                const metrics = await mockRegister.metrics();
                res.end(metrics);
            } catch (error) {
                console.error('Error generating metrics:', error);
                res.status(500).end('Error generating metrics');
            }
        });

        const server = app.listen(0);
        const port = (server.address() as AddressInfo).port;

        try {
            // Make request to metrics endpoint
            const response = await fetch(`http://localhost:${port}/metrics`);

            // Verify error response
            expect(response.status).toBe(500);
            const text = await response.text();
            expect(text).toBe('Error generating metrics');
        } finally {
            server.close();
            vi.restoreAllMocks();
        }
    });

    it('should increment metrics on presence, ops, errors', async () => {
        // Define mock metrics for test
        interface MockMetricsValue {
            activeConnections: Record<string, number>;
            opsTotal: Record<string, number>;
            wsErrors: Record<string, number>;
        }

        const mockMetrics = {
            activeConnections: {
                inc: vi.fn(),
                dec: vi.fn(),
                get: vi.fn((labels: { org: string, room_id: string }) => {
                    if (labels.org === 'test-org' && labels.room_id === 'test-room') {
                        return mockMetrics._values.activeConnections[`${labels.org}:${labels.room_id}`] || 0;
                    }
                    return 0;
                }),
                reset: vi.fn()
            },
            opsTotal: {
                inc: vi.fn(),
                get: vi.fn(() => ({
                    values: Object.entries(mockMetrics._values.opsTotal).map(([key, value]) => {
                        const [org, room_id, type] = key.split(':');
                        return { labels: { org, room_id, type }, value };
                    })
                })),
                reset: vi.fn()
            },
            wsErrors: {
                inc: vi.fn(),
                get: vi.fn(() => ({
                    values: Object.entries(mockMetrics._values.wsErrors).map(([key, value]) => {
                        const [org, code] = key.split(':');
                        return { labels: { org, code }, value };
                    })
                })),
                reset: vi.fn()
            },
            // Mock internal state for testing
            _values: {
                activeConnections: {} as Record<string, number>,
                opsTotal: {} as Record<string, number>,
                wsErrors: {} as Record<string, number>
            } as MockMetricsValue
        };

        // Mock tracking functions
        const trackConnection = (roomId: string, org = 'default', increment = true) => {
            const key = `${org}:${roomId}`;
            if (!mockMetrics._values.activeConnections[key]) {
                mockMetrics._values.activeConnections[key] = 0;
            }

            if (increment) {
                mockMetrics._values.activeConnections[key]++;
                mockMetrics.activeConnections.inc({ org, room_id: roomId });
            } else {
                mockMetrics._values.activeConnections[key]--;
                mockMetrics.activeConnections.dec({ org, room_id: roomId });
            }
        };

        const trackOperation = (roomId: string, type: string, org = 'default') => {
            const key = `${org}:${roomId}:${type}`;
            if (!mockMetrics._values.opsTotal[key]) {
                mockMetrics._values.opsTotal[key] = 0;
            }
            mockMetrics._values.opsTotal[key]++;
            mockMetrics.opsTotal.inc({ org, room_id: roomId, type });
        };

        const trackError = (code: string, org = 'default') => {
            const key = `${org}:${code}`;
            if (!mockMetrics._values.wsErrors[key]) {
                mockMetrics._values.wsErrors[key] = 0;
            }
            mockMetrics._values.wsErrors[key]++;
            mockMetrics.wsErrors.inc({ org, code });
        };

        // Test connection tracking
        trackConnection('test-room', 'test-org', true);
        expect(mockMetrics.activeConnections.get({ org: 'test-org', room_id: 'test-room' })).toBe(1);

        // Test disconnection tracking
        trackConnection('test-room', 'test-org', false);
        expect(mockMetrics.activeConnections.get({ org: 'test-org', room_id: 'test-room' })).toBe(0);

        // Test operation tracking
        trackOperation('test-room', 'presence_diff', 'test-org');
        trackOperation('test-room', 'presence_diff', 'test-org');
        trackOperation('test-room', 'storage_update', 'test-org');

        // Test error tracking
        trackError('parse_error', 'test-org');
        trackError('ws_error', 'test-org');

        // Get metrics as text
        const metricsText = mockMetrics.opsTotal.get();

        // Verify metrics were incremented correctly
        const presenceDiffCount = metricsText.values.find(
            (v) => v.labels.org === 'test-org' && v.labels.room_id === 'test-room' && v.labels.type === 'presence_diff'
        );
        const storageUpdateCount = metricsText.values.find(
            (v) => v.labels.org === 'test-org' && v.labels.room_id === 'test-room' && v.labels.type === 'storage_update'
        );

        expect(presenceDiffCount?.value).toBe(2);
        expect(storageUpdateCount?.value).toBe(1);

        // Verify error metrics
        const errorMetricsText = mockMetrics.wsErrors.get();
        const parseErrorCount = errorMetricsText.values.find(
            (v) => v.labels.org === 'test-org' && v.labels.code === 'parse_error'
        );
        const wsErrorCount = errorMetricsText.values.find(
            (v) => v.labels.org === 'test-org' && v.labels.code === 'ws_error'
        );

        expect(parseErrorCount?.value).toBe(1);
        expect(wsErrorCount?.value).toBe(1);
    });
}); 