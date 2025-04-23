// Global declaration file for modules without type definitions

declare module './connection' {
    export const useConnection: () => any;
    export const MessageType: { [key: string]: number };
    export const msgpack: {
        encode: (data: any) => Uint8Array;
        decode: (data: Uint8Array) => any;
    };
} 