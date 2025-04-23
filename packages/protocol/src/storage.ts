/**
 * LiveObject - conflict-free object with LWW semantics
 */
export interface LiveObject<T = Record<string, any>> {
    /**
     * Get current value
     */
    toObject(): T;
}

/**
 * LiveMap - conflict-free map with LWW semantics
 */
export interface LiveMap<T = any> {
    /**
     * Get value for key
     */
    get(key: string): T | undefined;

    /**
     * Set value for key
     */
    set(key: string, value: T): void;

    /**
     * Delete key
     */
    delete(key: string): void;

    /**
     * Get all entries
     */
    entries(): IterableIterator<[string, T]>;

    /**
     * Convert to plain object
     */
    toObject(): Record<string, T>;
}

/**
 * LiveList - conflict-free list with RGA semantics
 */
export interface LiveList<T = any> {
    /**
     * Get value at index
     */
    get(index: number): T | undefined;

    /**
     * Insert value at index
     */
    insert(index: number, value: T): void;

    /**
     * Delete value at index
     */
    delete(index: number): void;

    /**
     * Push value to end of list
     */
    push(value: T): void;

    /**
     * Get all values as array
     */
    toArray(): T[];
} 