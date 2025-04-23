import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useConnection } from './connection';
import { msgpack, MessageType } from './connection';

// Define StorageUpdateMessage interface
interface StorageUpdateMessage {
    type: number;
    update: Uint8Array;
}

/**
 * Hook for syncing a LiveObject
 * @param initial Initial object state
 * @returns [state, setState] tuple for the live object
 */
export function useLiveObject<T extends Record<string, any>>(initial: T) {
    const connection = useConnection();
    const [state, setState] = useState<T>(initial);
    const docRef = useRef<Y.Doc | null>(null);
    const mapRef = useRef<Y.Map<any> | null>(null);

    // Initialize Yjs document
    useEffect(() => {
        const doc = new Y.Doc();
        const map = doc.getMap('data');

        // Set initial data
        Object.entries(initial).forEach(([key, value]) => {
            map.set(key, value);
        });

        // Create handler to sync state from Yjs to React
        const updateState = () => {
            const newState = {} as T;
            map.forEach((value, key) => {
                newState[key as keyof T] = value as T[keyof T];
            });
            setState(newState);
        };

        // Subscribe to Yjs changes
        map.observe(updateState);

        docRef.current = doc;
        mapRef.current = map;

        return () => {
            map.unobserve(updateState);
            doc.destroy();
        };
    }, []);

    // Subscribe to connection updates
    useEffect(() => {
        if (!connection || !docRef.current) return;

        const handleStorageUpdate = (update: Uint8Array) => {
            const doc = docRef.current;
            if (!doc) return;

            Y.applyUpdate(doc, update);
        };

        connection.on('storageUpdate', handleStorageUpdate);

        return () => {
            connection.off('storageUpdate', handleStorageUpdate);
        };
    }, [connection]);

    // Update handler
    const updateObject = useCallback((update: Partial<T>) => {
        const map = mapRef.current;
        if (!map) return;

        // Apply update to Yjs
        Object.entries(update).forEach(([key, value]) => {
            map.set(key, value);
        });

        // Send update to server if connected
        if (connection?.isConnected && docRef.current) {
            const yUpdate = Y.encodeStateAsUpdate(docRef.current);
            const message: StorageUpdateMessage = {
                type: MessageType.STORAGE_UPDATE,
                update: yUpdate,
            };
            const encoded = new Uint8Array([
                MessageType.STORAGE_UPDATE,
                ...msgpack.encode(message)
            ]);
            connection.send(encoded);
        }
    }, [connection]);

    return [state, updateObject] as const;
}

/**
 * Creates storage hooks with typed states
 */
export function createStorageHooks() {
    return {
        useLiveObject,
    };
} 