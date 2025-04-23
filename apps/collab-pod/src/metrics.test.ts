import { describe, it, expect, beforeEach, vi } from 'vitest';
import { metrics, register, trackConnection, trackOperation, trackError, updateSystemMetrics } from './metrics';

// Mock the Prometheus client objects
vi.mock('prom-client', () => {
    const mockCounter = vi.fn().mockImplementation(() => ({
        inc: vi.fn(),
        labels: vi.fn().mockReturnThis(),
    }));

    const mockGauge = vi.fn().mockImplementation(() => ({
        inc: vi.fn(),
        dec: vi.fn(),
        set: vi.fn(),
        labels: vi.fn().mockReturnThis(),
    }));

    const mockHistogram = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        labels: vi.fn().mockReturnThis(),
    }));

    return {
        Counter: mockCounter,
        Gauge: mockGauge,
        Histogram: mockHistogram,
        register: {
            setDefaultLabels: vi.fn(),
            contentType: 'text/plain',
            metrics: vi.fn().mockResolvedValue('metrics data')
        }
    };
});

describe('Metrics Module', () => {
    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
    });

    it('should track connections', () => {
        // Test connection increment
        trackConnection('test-room', 'test-org', true);
        expect(metrics.activeConnections.inc).toHaveBeenCalledWith({
            org: 'test-org',
            room_id: 'test-room'
        });

        // Test connection decrement
        trackConnection('test-room', 'test-org', false);
        expect(metrics.activeConnections.dec).toHaveBeenCalledWith({
            org: 'test-org',
            room_id: 'test-room'
        });

        // Test with default values
        trackConnection('default-room');
        expect(metrics.activeConnections.inc).toHaveBeenCalledWith({
            org: 'default',
            room_id: 'default-room'
        });
    });

    it('should track operations', () => {
        // Test operation tracking
        trackOperation('test-room', 'presence_diff', 'test-org');
        expect(metrics.opsTotal.inc).toHaveBeenCalledWith({
            org: 'test-org',
            room_id: 'test-room',
            type: 'presence_diff'
        });

        // Test with default values
        trackOperation('default-room', 'storage_update');
        expect(metrics.opsTotal.inc).toHaveBeenCalledWith({
            org: 'default',
            room_id: 'default-room',
            type: 'storage_update'
        });
    });

    it('should track errors', () => {
        // Test error tracking
        trackError('parse_error', 'test-org');
        expect(metrics.wsErrors.inc).toHaveBeenCalledWith({
            org: 'test-org',
            code: 'parse_error'
        });

        // Test with default values
        trackError('auth_error');
        expect(metrics.wsErrors.inc).toHaveBeenCalledWith({
            org: 'default',
            code: 'auth_error'
        });
    });

    it('should update system metrics', () => {
        // Since mocking process.cpuUsage and process.memoryUsage causes typing issues,
        // we'll just verify that the metrics.cpuUsage.set and metrics.memUsage.set methods are called
        // when updateSystemMetrics is invoked.

        // Save original POD_ID environment variable
        const originalPodId = process.env.POD_ID;
        process.env.POD_ID = 'test-pod';

        // Run the function
        updateSystemMetrics();

        // Verify that the metrics set methods are called with the correct pod label
        expect(metrics.cpuUsage.set).toHaveBeenCalledWith(
            { pod: 'test-pod' },
            expect.any(Number)
        );
        expect(metrics.memUsage.set).toHaveBeenCalledWith(
            { pod: 'test-pod' },
            expect.any(Number)
        );

        // Restore original POD_ID
        if (originalPodId) {
            process.env.POD_ID = originalPodId;
        } else {
            delete process.env.POD_ID;
        }
    });

    it('should provide metrics data', async () => {
        const metricsData = await register.metrics();
        expect(metricsData).toBe('metrics data');
    });

    describe('HTTP Metrics Middleware', () => {
        it('should track HTTP request timing for normal routes', async () => {
            // Import the middleware
            const { httpMetricsMiddleware } = await import('./metrics');

            // Create mock request, response, and next function
            const req = { path: '/api/endpoint' } as any;
            const res = {
                on: vi.fn(),
                once: vi.fn(),
                emit: vi.fn()
            } as any;
            const next = vi.fn();

            // Test middleware
            httpMetricsMiddleware(req, res, next);

            // Verify that the response.on handler was registered
            expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

            // Verify that next was called
            expect(next).toHaveBeenCalled();

            // Simulate request completion by calling the 'finish' event handler
            const finishHandler = res.on.mock.calls[0][1];

            // Mock Date.now to return consistent values for timing
            const originalDateNow = Date.now;
            Date.now = vi.fn()
                .mockReturnValueOnce(1000) // Start time (should match the actual value when middleware ran)
                .mockReturnValueOnce(1100); // End time (100ms later)

            // Call the finish handler
            finishHandler();

            // Restore Date.now
            Date.now = originalDateNow;

            // No specific metrics should be observed for a general endpoint
            expect(metrics.presenceRtt.observe).not.toHaveBeenCalled();
            expect(metrics.storageOpRtt.observe).not.toHaveBeenCalled();
        });

        it('should track presence operation timing', async () => {
            // Import the middleware and tracking functions
            const { httpMetricsMiddleware, trackPresenceRtt } = await import('./metrics');

            // Create mock request with a presence endpoint
            const req = { path: '/presence/room1' } as any;
            const res = {
                on: vi.fn(),
                once: vi.fn(),
                emit: vi.fn()
            } as any;
            const next = vi.fn();

            // Spy on trackPresenceRtt function
            const trackPresenceSpy = vi.spyOn({ trackPresenceRtt }, 'trackPresenceRtt');

            // Test middleware
            httpMetricsMiddleware(req, res, next);

            // Simulate request completion
            const finishHandler = res.on.mock.calls[0][1];

            // Mock Date.now for consistent timing values
            const originalDateNow = Date.now;
            Date.now = vi.fn()
                .mockReturnValueOnce(1000) // Start time
                .mockReturnValueOnce(1150); // End time (150ms later)

            // Call the finish handler
            finishHandler();

            // Restore Date.now
            Date.now = originalDateNow;

            // Verify that presence metrics were observed
            expect(metrics.presenceRtt.observe).toHaveBeenCalledWith(
                { org: 'default' },
                expect.any(Number)
            );
        });

        it('should track storage operation timing', async () => {
            // Import the middleware and tracking functions
            const { httpMetricsMiddleware, trackStorageRtt } = await import('./metrics');

            // Create mock request with a storage endpoint
            const req = { path: '/storage/update' } as any;
            const res = {
                on: vi.fn(),
                once: vi.fn(),
                emit: vi.fn()
            } as any;
            const next = vi.fn();

            // Spy on trackStorageRtt function
            const trackStorageSpy = vi.spyOn({ trackStorageRtt }, 'trackStorageRtt');

            // Test middleware
            httpMetricsMiddleware(req, res, next);

            // Simulate request completion
            const finishHandler = res.on.mock.calls[0][1];

            // Mock Date.now for consistent timing values
            const originalDateNow = Date.now;
            Date.now = vi.fn()
                .mockReturnValueOnce(1000) // Start time
                .mockReturnValueOnce(1200); // End time (200ms later)

            // Call the finish handler
            finishHandler();

            // Restore Date.now
            Date.now = originalDateNow;

            // Verify that storage metrics were observed
            expect(metrics.storageOpRtt.observe).toHaveBeenCalledWith(
                { org: 'default' },
                expect.any(Number)
            );
        });
    });
}); 