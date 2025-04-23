import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Define NotificationType enum locally if we can't use the one from protocol
export enum NotificationType {
    COMMENT_POSTED = 'COMMENT_POSTED',
    MENTION = 'MENTION',
    REACTION = 'REACTION',
    SYSTEM = 'SYSTEM',
}

export type Notification = {
    id: string;
    user: string;
    type: NotificationType;
    message: string;
    roomId?: string;
    blockId?: string;
    actorId?: string;
    timestamp: Date;
    delivered: boolean;
    deliveryChannel?: 'in_app' | 'email' | 'slack';
    fail?: boolean;
    retries?: number;
};

// In-memory storage for notifications (in production, use Redis or other storage)
const queue: Notification[] = [];
const dlq: Notification[] = [];
const delivered: Notification[] = [];

// In-memory rate limiter (token bucket)
const limits: Record<string, { tokens: number, last: number }> = {};
const maxPerMinute = 20;
const maxDlqRetries = 5;

// Delivery adapters for different channels
const deliveryAdapters = {
    in_app: async (notification: Notification): Promise<boolean> => {
        // In-app notifications are delivered immediately to connected clients
        // This is just a placeholder - actual implementation would use WebSockets
        console.log(`Delivering in-app notification to ${notification.user}: ${notification.message}`);
        return true;
    },

    email: async (notification: Notification): Promise<boolean> => {
        try {
            // In a real implementation, this would use AWS SES, SendGrid, or similar
            console.log(`Sending email notification to ${notification.user}: ${notification.message}`);

            // Mock API call to email service
            if (notification.fail) {
                throw new Error('Failed to send email');
            }

            // In production, make a real API call
            // Example with AWS SES or similar service:
            /*
            await axios.post('https://email-service.example.com/send', {
                to: notification.user,
                subject: `CollabBlocks Notification: ${notification.type}`,
                body: notification.message,
                templateId: getTemplateForNotificationType(notification.type),
                variables: {
                    roomId: notification.roomId,
                    blockId: notification.blockId,
                    actor: notification.actorId
                }
            });
            */

            return true;
        } catch (error) {
            console.error(`Failed to send email notification: ${error}`);
            return false;
        }
    },

    slack: async (notification: Notification): Promise<boolean> => {
        try {
            // In a real implementation, this would use Slack API
            console.log(`Sending Slack notification to ${notification.user}: ${notification.message}`);

            // Mock API call to Slack
            if (notification.fail) {
                throw new Error('Failed to send Slack message');
            }

            // In production, make a real API call
            // Example with Slack API:
            /*
            await axios.post('https://slack.com/api/chat.postMessage', {
                channel: getUserSlackChannel(notification.user),
                text: notification.message,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: formatSlackMessage(notification)
                        }
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    text: "View in CollabBlocks"
                                },
                                url: generateDeepLink(notification)
                            }
                        ]
                    }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SLACK_TOKEN}`
                }
            });
            */

            return true;
        } catch (error) {
            console.error(`Failed to send Slack notification: ${error}`);
            return false;
        }
    }
};

/**
 * Check if a user can receive notifications (rate limiting)
 */
export function canSendNotification(user: string): boolean {
    const now = Date.now();
    if (!limits[user] || now - limits[user].last > 60000) {
        limits[user] = { tokens: maxPerMinute - 1, last: now };
        return true;
    }
    if (limits[user].tokens > 0) {
        limits[user].tokens--;
        limits[user].last = now;
        return true;
    }
    return false;
}

/**
 * Add a notification to the queue
 */
export function enqueueNotification(user: string, message: string, type: NotificationType = NotificationType.SYSTEM, options?: {
    roomId?: string;
    blockId?: string;
    actorId?: string;
    deliveryChannel?: 'in_app' | 'email' | 'slack';
    fail?: boolean;
}): string {
    // Check rate limiting
    if (!canSendNotification(user)) {
        console.warn(`Rate limit exceeded for user ${user}`);
        return '';
    }

    const id = uuidv4();
    const notification: Notification = {
        id,
        user,
        type,
        message,
        roomId: options?.roomId,
        blockId: options?.blockId,
        actorId: options?.actorId,
        timestamp: new Date(),
        delivered: false,
        deliveryChannel: options?.deliveryChannel || 'in_app',
        fail: options?.fail,
        retries: 0
    };

    queue.push(notification);
    return id;
}

/**
 * Get delivered notifications for a user
 */
export function getNotifications(user: string): Notification[] {
    return delivered.filter(n => n.user === user);
}

/**
 * Process the notification queue (should be called periodically)
 */
export async function processQueue() {
    console.log(`Processing notification queue. Items: ${queue.length}`);

    for (const notification of queue.slice()) {
        try {
            const channel = notification.deliveryChannel || 'in_app';
            const adapter = deliveryAdapters[channel];

            if (!adapter) {
                throw new Error(`Unknown delivery channel: ${channel}`);
            }

            const success = await adapter(notification);

            if (!success || notification.fail) {
                throw new Error('Delivery failed');
            }

            // Mark as delivered and move to delivered list
            notification.delivered = true;
            delivered.push(notification);

            // Remove from queue
            const index = queue.indexOf(notification);
            if (index !== -1) {
                queue.splice(index, 1);
            }

        } catch (error) {
            // Increment retry counter
            notification.retries = (notification.retries || 0) + 1;

            console.error(`Failed to deliver notification (attempt ${notification.retries}): ${error}`);

            // Move to DLQ after max retries
            if (notification.retries >= maxDlqRetries) {
                dlq.push(notification);
                const index = queue.indexOf(notification);
                if (index !== -1) {
                    queue.splice(index, 1);
                }
            }
        }
    }
}

/**
 * Get the dead letter queue
 */
export function getDLQ(): Notification[] {
    return dlq;
}

/**
 * Retry notifications from the dead letter queue
 */
export function retryDLQ() {
    for (const notification of dlq.slice()) {
        // Reset retry count and move back to main queue
        notification.retries = 0;
        queue.push(notification);

        // Remove from DLQ
        const index = dlq.indexOf(notification);
        if (index !== -1) {
            dlq.splice(index, 1);
        }
    }
}

// For backward compatibility
export function deliverNotifications(user: string): Notification[] {
    return getNotifications(user);
}

// Set up a timer to process the queue every 5 seconds
setInterval(processQueue, 5000); 