import _ from 'lodash-es';
import { PendingNotification } from './../../service.js';

export const processPendingNotifications = async (service, logger) => {
  logger.info('Processing pending notifications');
  const len = service.pendingQueue.length;
  logger.info('Pending mail queue length', { length: len });
  const failureQueue: PendingNotification[] = [];

  for (let i = 0; i < len; i++) {
    // flush
    const pendingNotif = service.pendingQueue.shift();
    const notification = pendingNotif.notification;
    try {
      await notification.send(pendingNotif.transport, service.logger);
      logger.info('Pending notifications sent successfully', { email: notification.email });
    } catch (err) {
      logger.error('Failed to send pending notification; inserting message back into the queue', { code: err.code, message: err.message, stack: err.stack });
      failureQueue.push(pendingNotif);
    }
  }
  if (!_.isEmpty(failureQueue)) { // restoring pending queue with potentially failed notifications
    service.pendingQueue = failureQueue;
  }
};