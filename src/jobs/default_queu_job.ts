import { processPendingNotifications } from './implementation/process_pending_notifications_job';
import { PROCESS_PENDING_NOTIFICATIONS } from './../service';

export default async (cfg, logger, events, service, runWorker) => {
  await runWorker('defaultQueue', 1, cfg, logger, events, async (job) => {
    if (job.type === PROCESS_PENDING_NOTIFICATIONS) {
      await processPendingNotifications(service, logger);
    }
  });
};