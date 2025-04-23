import { useCallback, useEffect, useRef, useState } from 'react';
import { PresenceState, MessageType, msgpack } from '@collabblocks/protocol';
import { useConnection } from './connection';

/**
 * Hook to manage the current user's presence
 * @returns [state, setState] tuple for managing presence
 */
export function useMyPresence() {
    const connection = useConnection();
    const [myPresence, setMyPresence] = useState<Partial<PresenceState>>({});
    const lastPresenceRef = useRef<Partial<PresenceState>>({});

    // Debounce presence updates
    const updatePresence = useCallback((update: Partial<PresenceState>) => {
        const newPresence = { ...lastPresenceRef.current, ...update };
        lastPresenceRef.current = newPresence;
        setMyPresence(newPresence);

        // Only send if connected
        if (connection?.isConnected) {
            const message = new Uint8Array([
                MessageType.PRESENCE_DIFF,
                ...msgpack.encode(update)
            ]);
            connection.send(message);
        }
    }, [connection]);

    return [myPresence, updatePresence] as const;
}

/**
 * Hook to access other users' presence
 * @param selector Optional selector function
 * @returns Other users' presence states
 */
export function useOthers<T = PresenceState[]>(
    selector?: (others: PresenceState[]) => T
): T | PresenceState[] {
    const connection = useConnection();
    const [others, setOthers] = useState<PresenceState[]>([]);

    useEffect(() => {
        if (!connection) return;

        const handlePresenceUpdate = (userId: string, update: Partial<PresenceState>) => {
            setOthers(prev => {
                const index = prev.findIndex(p => p.meta?.userId === userId);
                if (index === -1) {
                    return [...prev, { ...update, meta: { ...update.meta, userId } }];
                }

                const newOthers = [...prev];
                newOthers[index] = { ...newOthers[index], ...update };
                return newOthers;
            });
        };

        connection.on('presence', handlePresenceUpdate);

        return () => {
            connection.off('presence', handlePresenceUpdate);
        };
    }, [connection]);

    if (selector) {
        return selector(others);
    }

    return others;
}

/**
 * Creates presence hooks with typed states
 */
export function createPresenceHooks<T extends PresenceState = PresenceState>() {
    return {
        useMyPresence: useMyPresence as () => [Partial<T>, (update: Partial<T>) => void],
        useOthers: useOthers as <S = T[]>(selector?: (others: T[]) => S) => S | T[],
    };
}

/**
 * Hook to track cursor position
 */
export function useCursor() {
    const [myPresence, updatePresence] = useMyPresence();
    const others = useOthers(state => state.map(o => ({
        cursor: o.cursor,
        userId: o.meta?.userId as string
    })));

    const setCursor = useCallback((x: number, y: number) => {
        updatePresence({ cursor: { x, y } });
    }, [updatePresence]);

    return {
        cursor: myPresence.cursor,
        otherCursors: others,
        setCursor,
    };
} 