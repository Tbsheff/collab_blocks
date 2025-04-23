import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import express from 'express';
import { PresenceManager } from './presence/manager';
import { StorageEngine } from './storage/engine';
import * as Y from 'yjs';
import Redis from 'ioredis';

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
        pm.applyDiff('room1', 'user1', { x: 1, y: 2 });
        const state = pm.getFullState('room1');
        expect(state.length).toBe(1);
        expect(state[0]).toMatchObject({ x: 1, y: 2 });
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
        await pm.applyDiff(roomId, userId, { x: 1, y: 2 });
        let state = pm.getFullState(roomId);
        expect(state.length).toBe(1);
        expect(state[0]).toMatchObject({ x: 1, y: 2 });

        // Update presence
        await pm.applyDiff(roomId, userId, { x: 3 });
        state = pm.getFullState(roomId);
        expect(state[0]).toMatchObject({ x: 3, y: 2 });

        // Check Redis stream
        const entries = await redis.xrange('presence-' + roomId, '-', '+');
        expect(entries.length).toBeGreaterThanOrEqual(2);
        const lastEntry = entries[entries.length - 1][1];
        const diffFieldIndex = lastEntry.findIndex((v: string) => v === 'diff');
        expect(diffFieldIndex).toBeGreaterThan(-1);
        const diff = JSON.parse(lastEntry[diffFieldIndex + 1]);
        expect(diff).toMatchObject({ x: 3 });

        // Remove presence
        pm.removeUser(roomId, userId);
        state = pm.getFullState(roomId);
        expect(state).toEqual([]);
    });

    it('should expire presence after TTL', async () => {
        // Use a short TTL for testing
        const shortTTL = 100;
        const pmShort = new PresenceManager(redis, shortTTL);
        await pmShort.applyDiff(roomId, userId, { x: 1 });
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
        await pmPod1.applyDiff(roomId, userId, { x: 42 });

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
        expect(diff).toMatchObject({ x: 42 });

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
        await client.query('DELETE FROM ops_ WHERE room_id = $1', [123]);

        // Create a StorageEngine with Postgres
        // TODO: Update StorageEngine to accept a pg.Client
        const se = new StorageEngine(undefined, client);
        const roomId = 123;
        const doc = se.getDocument(roomId);
        doc.getMap('data').set('foo', 'persisted');
        // Persist the update
        const update = se.getState(roomId);
        await se.persistOp(roomId, update); // TODO: Implement persistOp

        // Simulate restart: new StorageEngine instance
        const se2 = new StorageEngine(undefined, client);
        // Load ops from Postgres and replay
        const ops = await se2.loadOps(roomId); // TODO: Implement loadOps
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

describe('WebSocket Protocol', () => {
    it('should accept valid JWT and reject invalid tokens', () => {
        // TODO: Implement test
    });

    it('should join/leave rooms and receive correct initial state', () => {
        // TODO: Implement test
    });

    it('should handle multiple users in the same room', () => {
        // TODO: Implement test
    });
});

describe('Broadcast Channel & Threaded Comments', () => {
    it('should send and receive broadcast messages in a room', () => {
        // TODO: Implement test
    });

    it('should create, fetch, and thread comments per block/room', () => {
        // TODO: Implement test
    });
});

describe('Notifications System', () => {
    it('should enqueue and deliver notifications via NATS', () => {
        // TODO: Implement test
    });

    it('should enforce per-user rate limits', () => {
        // TODO: Implement test
    });

    it('should retry and dead-letter failed notifications', () => {
        // TODO: Implement test
    });
});

describe('Monitoring Dashboard', () => {
    it('should expose Prometheus metrics endpoint', () => {
        // TODO: Implement test
    });

    it('should increment metrics on presence, ops, errors', () => {
        // TODO: Implement test
    });
}); 