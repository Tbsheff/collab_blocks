import * as Y from 'yjs';

/**
 * Manages CRDT documents for rooms
 */
export class StorageEngine {
    // Room ID -> Yjs Doc
    private rooms = new Map<string, Y.Doc>();

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
} 