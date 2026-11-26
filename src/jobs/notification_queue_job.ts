import { type DefaultExportFunc } from '@restorecommerce/scs-jobs';
import { Logger } from '@restorecommerce/logger';
import { NotificationService, PendingNotification } from '../service.js';

const PROCESS_PENDING_NOTIFICATIONS = 'process-pending-notifications-job';
const processPendingNotifications = async (service: NotificationService, logger: Logger) => {
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
    } catch (err: any) {
      const { code, message, stack } = err;
      logger.error('Failed to send pending notification; inserting message back into the queue', { code, message, stack } );
      failureQueue.push(pendingNotif);
    }
  }
  if (failureQueue?.length) { // restoring pending queue with potentially failed notifications
    service.pendingQueue = failureQueue;
  }
};

const main: DefaultExportFunc = async (cfg, logger, events, runWorker, service) => {
  await runWorker('notification-srv-queue', 1, cfg, logger, events, async (job) => {
    if (job.type === PROCESS_PENDING_NOTIFICATIONS) {
      await processPendingNotifications(service, logger);
    }
  });
};

export default main;
