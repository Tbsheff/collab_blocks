// Import Vitest's expect first
import { expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
// Then import the matchers from jest-dom
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Setup a simple mock for global fetch
const originalFetch = global.fetch;
global.fetch = vi.fn();

// Enable fake timers
vi.useFakeTimers();

// Add cleanup to restore original fetch after tests
beforeEach(() => {
    global.fetch = vi.fn();
});

// Clean up DOM after each test
afterEach(() => {
    vi.clearAllMocks();
    cleanup(); // This removes any rendered components from the DOM
});

afterAll(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
});

// This file is included in vitest.config.ts as the setupFiles entry
// to configure the test environment. 