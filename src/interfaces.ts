import { Notification } from './notification';

export interface PendingNotification {
  notification: Notification;
  transport: NotificationTransport;
}

export type NotificationTransport = 'log' | 'email';
