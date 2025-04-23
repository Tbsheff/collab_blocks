import * as Y from 'yjs';
import type { Client } from 'pg';

/**
 * Manages CRDT documents for rooms, with optional Postgres persistence
 */
export class StorageEngine {
    // Room ID -> Yjs Doc
    private rooms = new Map<string, Y.Doc>();
    private pgClient?: Client;

    constructor(pgClient?: Client) {
        this.pgClient = pgClient;
    }

    /**
     * Get or create a Yjs document for a room
     */
    public getDocument(roomId: string): Y.Doc {
        let doc = this.rooms.get(roomId);

        if (!doc) {
            doc = new Y.Doc();
            this.rooms.set(roomId, doc);
        }

        return doc;
    }

    /**
     * Apply Yjs update to a room's document
     * @returns The merged update to broadcast to other clients
     */
    public applyUpdate(roomId: string, update: Uint8Array): Uint8Array {
        const doc = this.getDocument(roomId);

        // Apply the update
        Y.applyUpdate(doc, update);

        // Return the update for broadcasting
        return update;
    }

    /**
     * Get the current state of a room's document
     */
    public getState(roomId: string): Uint8Array {
        const doc = this.getDocument(roomId);
        return Y.encodeStateAsUpdate(doc);
    }

    /**
     * Remove a room's document
     */
    public removeRoom(roomId: string): void {
        const doc = this.rooms.get(roomId);

        if (doc) {
            doc.destroy();
            this.rooms.delete(roomId);
        }
    }

    /**
     * Persist a CRDT op to Postgres
     */
    public async persistOp(roomId: string, update: Uint8Array): Promise<void> {
        if (!this.pgClient) throw new Error('No Postgres client');
        // Use a simple incrementing seq for demo (not production safe)
        const seq = Date.now();
        await this.pgClient.query(
            'INSERT INTO ops_ (room_id, seq, site_id, op_bin) VALUES ($1, $2, $3, $4)',
            [roomId, seq, 1, Buffer.from(update)]
        );
    }

    /**
     * Load all ops for a room from Postgres
     */
    public async loadOps(roomId: string): Promise<Uint8Array[]> {
        if (!this.pgClient) throw new Error('No Postgres client');
        const res = await this.pgClient.query('SELECT op_bin FROM ops_ WHERE room_id = $1 ORDER BY seq ASC', [roomId]);
        return res.rows.map((row: any) => new Uint8Array(row.op_bin));
    }
} 