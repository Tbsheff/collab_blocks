// Global declaration file for modules without type definitions

declare module './connection' {
    export const useConnection: () => any;
    export const MessageType: { [key: string]: number };
    export const msgpack: {
        encode: (data: any) => Uint8Array;
        decode: (data: Uint8Array) => any;
    };
}

import { expect, vi } from 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Extend Vitest's assertions with Testing Library matchers
declare module 'vitest' {
    interface Assertion<T = any> extends TestingLibraryMatchers<T, void> { }
    interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, void> { }
}

// For older versions of jest-dom, use this alternative declaration
declare global {
    namespace Vi {
        interface JestAssertion<T = any> extends TestingLibraryMatchers<T, void> { }
    }

    // Add Jest compatibility for jest-fetch-mock
    const jest: {
        fn: typeof vi.fn;
        spyOn: typeof vi.spyOn;
        mock: typeof vi.mock;
    };

    // Make sure fetch is properly typed for jest-fetch-mock
    interface Window {
        fetch: jest.Mock;
    }

    var fetch: jest.Mock;
} 