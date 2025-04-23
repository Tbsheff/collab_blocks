import { Counter, Gauge, Histogram, register } from 'prom-client';
import { NextFunction, Request, Response } from 'express';

// Initialize Prometheus metrics
const metrics = {
    // Connection metrics
    activeConnections: new Gauge({
        name: 'collab_active_connections',
        help: 'Number of active WebSocket connections',
        labelNames: ['org', 'room_id'] as const,
    }),

    // Operation metrics
    opsTotal: new Counter({
        name: 'crdt_ops_total',
        help: 'Total number of CRDT operations applied',
        labelNames: ['org', 'room_id', 'type'] as const,
    }),

    // Latency metrics
    presenceRtt: new Histogram({
        name: 'presence_rtt_ms',
        help: 'Round-trip time for presence updates in milliseconds',
        labelNames: ['org'] as const,
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
    }),

    storageOpRtt: new Histogram({
        name: 'storage_op_rtt_ms',
        help: 'Round-trip time for storage operations in milliseconds',
        labelNames: ['org'] as const,
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
    }),

    // Error metrics
    wsErrors: new Counter({
        name: 'ws_errors_total',
        help: 'Total number of WebSocket errors',
        labelNames: ['org', 'code'] as const,
    }),

    // Infrastructure metrics
    cpuUsage: new Gauge({
        name: 'cpu_usage',
        help: 'CPU usage percentage',
        labelNames: ['pod'] as const,
    }),

    memUsage: new Gauge({
        name: 'mem_usage',
        help: 'Memory usage in bytes',
        labelNames: ['pod'] as const,
    }),
};

// Start collecting default metrics (GC, CPU, memory)
register.setDefaultLabels({
    app: 'collab-pod',
});

// Helper functions to track metrics
const trackConnection = (roomId: string, org = 'default', increment = true) => {
    // Increment or decrement the gauge based on the action
    const method = increment ? 'inc' : 'dec';
    metrics.activeConnections[method]({ org, room_id: roomId });
};

const trackOperation = (roomId: string, type: string, org = 'default') => {
    metrics.opsTotal.inc({ org, room_id: roomId, type });
};

const trackError = (code: string, org = 'default') => {
    metrics.wsErrors.inc({ org, code });
};

const trackPresenceRtt = (durationMs: number, org = 'default') => {
    metrics.presenceRtt.observe({ org }, durationMs);
};

const trackStorageRtt = (durationMs: number, org = 'default') => {
    metrics.storageOpRtt.observe({ org }, durationMs);
};

// Middleware to track HTTP requests
const httpMetricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Track response time when request completes
    res.on('finish', () => {
        const duration = Date.now() - start;

        // If this is a storage or presence operation, track specific metrics
        const path = req.path;
        if (path.includes('/presence')) {
            trackPresenceRtt(duration);
        } else if (path.includes('/storage')) {
            trackStorageRtt(duration);
        }
    });

    next();
};

// Update system metrics periodically
const updateSystemMetrics = () => {
    // Get current CPU and memory usage
    const podId = process.env.POD_ID || 'local';

    // CPU usage (process.cpuUsage returns microseconds)
    const cpuUsage = process.cpuUsage();
    const totalCpuUsage = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
    metrics.cpuUsage.set({ pod: podId }, totalCpuUsage);

    // Memory usage
    const memUsage = process.memoryUsage();
    metrics.memUsage.set({ pod: podId }, memUsage.rss);
};

// Start collecting system metrics every 15 seconds
setInterval(updateSystemMetrics, 15000);

export {
    metrics,
    register,
    trackConnection,
    trackOperation,
    trackError,
    trackPresenceRtt,
    trackStorageRtt,
    httpMetricsMiddleware,
    updateSystemMetrics
}; 