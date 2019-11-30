import { Notification } from './notification';

export interface PendingNotification {
  notification: Notification;
  transport: NotificationTransport;
}

export interface Log {
  level: string;
}

export interface Email {
  to: string[];
  cc: string[];
  bcc: string[];
}

export type NotificationTransport = 'log' | 'email';
