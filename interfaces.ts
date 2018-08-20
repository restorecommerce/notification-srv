import { Notification } from "./lib/notification";

export interface PendingNotification {
    notification: Notification;
    transport: NotificationTransport;
}

export type NotificationTransport = 'log' | 'mail';