export * from './connection';
export {
    useMyPresence,
    useOthers,
    createPresenceHooks,
    useCursor
} from './presence';
export type { PresenceState } from './presence';
export * from './storage';
export * from './comments';
export * from './comments/index';

// Re-export createClient as the main API
export { useCreateConnection as createClient } from './connection';
export { createStorageHooks } from './storage';
export { CommentsProvider, useComments, useBlockComments } from './comments';
export { CommentsThread } from './comments/CommentsThread'; 