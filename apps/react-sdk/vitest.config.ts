import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        setupFiles: './src/vitest.setup.ts', // Point to the new setup file
        globals: false, // We are importing globals explicitly
        environment: 'jsdom', // Simulate a browser environment
        testTimeout: 30000, // Increase timeout to 30 seconds
    },
}); 