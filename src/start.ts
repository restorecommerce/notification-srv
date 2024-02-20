import { start, stop } from './service.js';
import { createLogger } from '@restorecommerce/logger';
import { createServiceConfig } from '@restorecommerce/service-config';

const cfg = createServiceConfig(process.cwd());
const loggerCfg = cfg.get('logger');
loggerCfg.esTransformer = (msg) => {
  msg.fields = JSON.stringify(msg.fields);
  return msg;
};
const logger = createLogger(loggerCfg);


start(cfg, logger).then().catch((err) => {
  logger.error('startup error', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  stop().then().catch((err) => {
    logger.error('shutdown error', err);
    process.exit(1);
  });
});