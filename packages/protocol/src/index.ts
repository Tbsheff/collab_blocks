import { encode, decode } from '@msgpack/msgpack';

export * from './presence';
export * from './storage';
export * from './comments';
export * from './notifications';
export * from './messages';

/**
 * MsgPack encoding utils
 */
export const msgpack = {
    /**
     * Encode data to MsgPack binary format
     */
    encode,

    /**
     * Decode MsgPack binary data
     */
    decode,
}; 