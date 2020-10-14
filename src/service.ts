import * as _ from 'lodash';
// microservice
import * as chassis from '@restorecommerce/chassis-srv';
import { createLogger } from '@restorecommerce/logger';
import { createServiceConfig } from '@restorecommerce/service-config';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Client } from '@restorecommerce/grpc-client';
import { Notification } from './notification';
import { PendingNotification, NotificationTransport } from './interfaces';
import { createClient } from 'redis';

const SEND_MAIL_EVENT = 'sendEmail';
const HEALTH_CHECK_CMD_EVENT = 'healthCheckCommand';
const VERSION_CMD_EVENT = 'versionCommand';
const QUEUED_JOB_EVENT = 'queuedJob';
const FLUSH_NOTIFICATIONS_JOB_TYPE = 'flushPendingNotificationsJob';
const MAIL_SERVER_CREDENTIALS = 'mail_server_credentials';

let server: chassis.Server;
let service: NotificationService;
let events: Events;
let offsetStore: chassis.OffsetStore;

/*
 * Main API for sending notifications.
 * Exposes methods via gRPC.
 */
export class NotificationService {
  events: Events;
  server: chassis.Server;
  logger: chassis.Logger;
  cfg: any;
  pendingQueue: PendingNotification[];
  constructor(cfg: any, events: Events, server: chassis.Server, logger: chassis.Logger) {
    this.cfg = cfg;
    this.server = server;
    this.logger = logger;
    this.events = events;
    this.pendingQueue = [];
  }

  /**
   * helper function which invokes different transport notifications
   * @param request contians the transport channel detail
   * @param context
   */
  async send(request: any, context: any): Promise<any> {
    const transport = request.request.transport;
    if (transport === 'email' || transport === 'log') {
      return this.sendNotification(request.request);
    } else {
      this.logger.error('Transport not implemented:', transport);
    }
  }

  async sendNotification(data: any): Promise<any> {
    const transport: NotificationTransport = data.transport;
    let notification: Notification;
    if (transport == 'log') {
      const { userId, subjectId, bodyId } = data;
      notification = new Notification(this.cfg, {
        userId, subjectId, bodyId
      });
    } else {
      const { body, email, subject, target, attachments, bcc, cc } = data;
      notification = new Notification(this.cfg, {
        email, target, subject, body, attachments, bcc, cc
      });
    }

    try {
      await notification.send(transport, service.logger);
    } catch (err) {
      let toQueue = !!err.responseCode || err.code == 'ECONNECTION' || err.command == 'CONN';
      if (err.responseCode) { // SMTP response codes
        this.logger.error('Error while sending email: ' + err.responseCode);
        // "code":"EAUTH","response":"454 4.7.0 Temporary authentication failure:
        // Connection lost to authentication server","responseCode":454
        if ([451, 454, 550, 501, 553, 556, 552, 554].indexOf(err.responseCode) == -1) { // ignoring messages related with invalid messages or email addresses
          toQueue = false;
        }
      }

      if (toQueue) {
        this.logger.verbose('Queueing email message');
        this.pendingQueue.push({
          transport: 'email',
          notification
        });
      }

    }
  }
}

/*
 * starting the actual server
 * @param cfg
 */
export async function start(cfg?: any): Promise<any> {
  if (!cfg) {
    cfg = createServiceConfig(process.cwd());
  }
  const logger = createLogger(cfg.get('logger'));
  // Make a gRPC call to resource service for credentials resource and update
  // cfg for user and pass for mail server
  if (!_.isEmpty(cfg.get('client:service'))) {
    const client: Client = new Client(cfg.get('client:service'), logger);
    const credentialService = await client.connect();
    const result = await credentialService.read({});
    if (result && result.data && result.data.items) {
      const credentialsList = result.data.items;
      for (let credential of credentialsList) {
        if (credential.id === MAIL_SERVER_CREDENTIALS) {
          cfg.set('server:mailer:auth:user', credential.user);
          cfg.set('server:mailer:auth:pass', credential.pass);
          break;
        }
      }
    }
  }

  server = new chassis.Server(cfg.get('server'), logger);

  // prepare kafka & events
  let kafkaCfg = cfg.get('events:kafka');

  events = new Events(kafkaCfg, logger);
  await events.start();
  offsetStore = new chassis.OffsetStore(events, cfg, logger);

  // init redis client for subject index
  const redisConfig = cfg.get('redis');
  redisConfig.db = cfg.get('redis:db-indexes:db-subject');
  const redisClient = createClient(redisConfig);

  // exposing commands as gRPC methods through chassis
  // as 'commandinterface
  const serviceNamesCfg = cfg.get('serviceNames');
  const cis = new chassis.CommandInterface(server,
    cfg, logger, events, redisClient);
  const cisName = serviceNamesCfg.cis;
  await server.bind(cisName, cis);

  const notificationEventListener = async (msg: any, context: any, config: any, eventName: string): Promise<any> => {
    if (eventName === SEND_MAIL_EVENT) {
      const notificationObj = msg;
      const notification: Notification = new Notification(cfg, notificationObj);
      try {
        await service.sendNotification(msg);
      } catch (err) {
        this.logger.error('Error while sending notification; adding message to pending notifications...');
        this.pendingQueue.push({
          transport: 'email',
          notification
        });
      }
    }
    else if (eventName === HEALTH_CHECK_CMD_EVENT || eventName === VERSION_CMD_EVENT) {
      await cis.command(msg, context);
    } else if (eventName == QUEUED_JOB_EVENT) {
      if (msg.type == FLUSH_NOTIFICATIONS_JOB_TYPE) {
        logger.info('Processing notifications flush request...');
        const len = service.pendingQueue.length;
        logger.info('Pending mail queue length:', { length: len });
        let failureQueue: PendingNotification[] = [];

        for (let i = 0; i < len; i++) {
          // flush
          const pendingNotif = service.pendingQueue.shift();
          const notification = pendingNotif.notification;
          try {
            await notification.send(pendingNotif.transport, service.logger);
          } catch (err) {
            service.logger.error('Failed to send pending notification; inserting message back into the queue');
            failureQueue.push(pendingNotif);
          }
        }
        if (!_.isEmpty(failureQueue)) { // restoring pending queue with potentially failed notifications
          service.pendingQueue = failureQueue;
        }
      }
    }
  };

  // finally create the service and bind to the server
  service = new NotificationService(cfg, events, server, logger);
  // Subsribe to notification topic to send out notification when the message
  // arrives on notification topic
  // (topic name is notification and eventName is sendEmail)
  const topicTypes = _.keys(kafkaCfg.topics);
  for (let topicType of topicTypes) {
    const topicName = kafkaCfg.topics[topicType].topic;
    const topic: Topic = events.topic(topicName);
    const offsetValue = await offsetStore.getOffset(topicName);
    logger.info(`subscribing to topic ${topicName} with offset value:`, offsetValue);
    if (kafkaCfg.topics[topicType].events) {
      const eventNames = kafkaCfg.topics[topicType].events;
      for (let eventName of eventNames) {
        await topic.on(eventName, notificationEventListener,
          { startingOffset: offsetValue });
      }
    }
  }

  await server.bind(serviceNamesCfg.notification, service);

  // Add ReflectionService
  const reflectionServiceName = serviceNamesCfg.reflection;
  const transportName = cfg.get(`server:services:${reflectionServiceName}:serverReflectionInfo:transport:0`);
  const transport = server.transport[transportName];
  const reflectionService = new chassis.ServerReflection(transport.$builder, server.config);
  await server.bind(reflectionServiceName, reflectionService);

  await server.bind(serviceNamesCfg.health, new chassis.Health(cis, async () => {
    return redisClient.ping();
  }));

  await server.start();
  return service;
}

export const stop = async (): Promise<any> => {
  await server.stop();
  await events.stop();
  await offsetStore.stop();
};

if (require.main === module) {
  start().catch((err) => {
    console.error('client error', err.stack);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    stop().catch((err) => {
      console.error('shutdown error', err);
      process.exit(1);
    });
  });
}
