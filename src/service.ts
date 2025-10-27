import _ from 'lodash-es';
// microservice
import { Server, OffsetStore, CommandInterface, buildReflectionService, Health } from '@restorecommerce/chassis-srv';
import { createLogger } from '@restorecommerce/logger';
import { createServiceConfig } from '@restorecommerce/service-config';
import { Events, Topic, registerProtoMeta } from '@restorecommerce/kafka-client';
import { createClient as grpcCreateClient, createChannel } from '@restorecommerce/grpc-client';
import { Notification } from './notification.js';
import { createClient, RedisClientType } from 'redis';
import { Logger } from 'winston';
import { operation as retryOperation } from 'retry';
import {
  NotificationReqServiceDefinition,
  protoMetadata as NotificationReqMeta, NotificationReq
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/notification_req.js';
import { OperationStatusObj } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';
import {
  CommandInterfaceServiceDefinition,
  protoMetadata as CommandInterfaceMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/commandinterface.js';
import {
  protoMetadata as reflectionMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/grpc/reflection/v1alpha/reflection.js';
import { ServerReflectionService } from 'nice-grpc-server-reflection';
import { BindConfig } from '@restorecommerce/chassis-srv/lib/microservice/transport/provider/grpc/index.js';
import { HealthDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/grpc/health/v1/health.js';
import {
  CredentialServiceDefinition,
  CredentialServiceClient
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/credential.js';
import {
  ReadRequest
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import * as fs from 'node:fs';
import { runWorker } from '@restorecommerce/scs-jobs';
import {
  protoMetadata as jobMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/job.js';


registerProtoMeta(NotificationReqMeta, CommandInterfaceMeta, reflectionMeta, jobMeta);
const SEND_MAIL_EVENT = 'sendEmail';
const HEALTH_CHECK_CMD_EVENT = 'healthCheckCommand';
const VERSION_CMD_EVENT = 'versionCommand';
export const PROCESS_PENDING_NOTIFICATIONS = 'process-pending-notifications-job';
const MAIL_SERVER_CREDENTIALS = 'mail_server_credentials';

let server: Server;
let service: NotificationService;
let events: Events;
let offsetStore: OffsetStore;

/*
 * Main API for sending notifications.
 * Exposes methods via gRPC.
 */
export class NotificationService {
  events: Events;
  server: Server;
  logger: Logger;
  cfg: any;
  pendingQueue: PendingNotification[];
  constructor(cfg: any, events: Events, server: Server, logger: Logger) {
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
  async send(request: NotificationReq, context: any): Promise<OperationStatusObj> {
    const transport = request.transport;
    if (transport === 'email' || transport === 'log') {
      return this.sendNotification(request);
    } else {
      this.logger.error(`Transport ${transport} not implemented`);
      return {
        operation_status: {
          code: 404,
          message: `Transport ${transport} not implemented`
        }
      };
    }
  }

  async sendNotification(data: NotificationReq): Promise<OperationStatusObj> {
    const transport = data.transport;
    let notification: Notification;
    let email;
    if (transport == 'log') {
      const { log } = data;
      notification = new Notification(this.cfg, {
        log, level: log.level
      });
    } else {
      const { body, subject, attachments } = data;
      email = data.email;
      notification = new Notification(this.cfg, {
        email, subject, body, attachments
      });
    }

    try {
      const sendNotificationResp = await notification.send(transport, service.logger);
      this.logger.info('Notification sent successfully', { email });
      if (sendNotificationResp.response) {
        return {
          operation_status: {
            code: 200,
            message: 'success'
          }
        };
      }
    } catch (err) {
      let toQueue = !!err.responseCode || err.code == 'ECONNECTION' || err.command == 'CONN';
      if (err.responseCode) { // SMTP response codes
        this.logger.error('Error sending email', { code: err.responseCode, message: err.message, stack: err.stack });
        // "code":"EAUTH","response":"454 4.7.0 Temporary authentication failure:
        // Connection lost to authentication server","responseCode":454
        // included authentication error due to login credentials 530 (to resend the email from pending queue)
        // error code EAUTH 421 - Error: too many connections (to be retried again)
        if ([421, 451, 454, 550, 501, 530, 553, 556, 552, 554].indexOf(err.responseCode) == -1) {
          // ignoring messages related with invalid messages or email addresses other than the above error codes
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
      return {
        operation_status: {
          code: err.code,
          message: err.message
        }
      };
    }
  }
}

export interface PendingNotification {
  notification: Notification;
  transport: NotificationTransport;
}

type NotificationTransport = 'log' | 'email';

/*
 * starting the actual server
 * @param cfg
 */
export const start = async (cfg?: any, logger?: Logger): Promise<any> => {
  if (!cfg) {
    cfg = createServiceConfig(process.cwd());
  }
  if (!logger) {
    const loggerCfg = cfg.get('logger');
    logger = createLogger(loggerCfg);
  }
  const credentialServiceCfg = cfg.get('client:credentialService');
  // Make a gRPC call to resource service for credentials resource and update
  // cfg for user and pass for mail server (if its not set up in config - server:mailer:auth:user)
  if (!cfg.get('server:mailer:auth:user') && !_.isEmpty(cfg.get('client:credentialService'))) {
    const channel = createChannel(credentialServiceCfg.address);
    const credentialService: CredentialServiceClient = grpcCreateClient({
      ...credentialServiceCfg,
      logger
    }, CredentialServiceDefinition, channel);
    // retry mechanism, till the credentials are read from resource-srv
    const maxTo = cfg.get('retry:maxTimeout') || 2000;
    logger.info(`Retrying with maxTimeout:${maxTo}`);
    const operation = retryOperation({ forever: true, maxTimeout: maxTo });

    await new Promise((resolve, reject) => {
      operation.attempt(async () => {
        const result = await credentialService.read(ReadRequest.fromPartial({}));
        await new Promise((resolve, reject) => {
          if (result?.items?.length > 0) {
            const credentialsList = result.items;
            for (const credentialObj of credentialsList) {
              if (credentialObj?.payload?.id === MAIL_SERVER_CREDENTIALS) {
                cfg.set('server:mailer:auth:user', credentialObj.payload.user);
                cfg.set('server:mailer:auth:pass', credentialObj.payload.pass);
                break;
              }
            }
            resolve(true);
          } else {
            const err = 'Either resource-srv is unreachable or mail server credentials do not exist in DB';
            logger.error(err);
            reject(err);
          }
        }).then((resp) => {
          resolve(resp);
        }).catch(err => {
          const attemptNo = operation.attempts();
          logger.info(`Retry connecting to Resource Service, attempt no: ${attemptNo}`);
          operation.retry(err);
        });
      });
    });
  }

  server = new Server(cfg.get('server'), logger);

  // prepare kafka & events
  const kafkaCfg = cfg.get('events:kafka');

  events = new Events(kafkaCfg, logger);
  await events.start();
  offsetStore = new OffsetStore(events, cfg, logger);

  // init redis client for subject index
  const redisConfig = cfg.get('redis');
  redisConfig.database = cfg.get('redis:db-indexes:db-subject');
  const redisClient: RedisClientType<any, any> = createClient(redisConfig);
  redisClient.on('error', (err) => logger.error('Redis client error in subject store', { code: err.code, message: err.message, stack: err.stack }));
  await redisClient.connect();
  // exposing commands as gRPC methods through chassis
  // as 'commandinterface
  const serviceNamesCfg = cfg.get('serviceNames');
  const cis = new CommandInterface(server,
    cfg, logger, events, redisClient);
  const cisName = serviceNamesCfg.cis;
  await server.bind(cisName, {
    service: CommandInterfaceServiceDefinition,
    implementation: cis
  } as BindConfig<CommandInterfaceServiceDefinition>);

  // create the service and bind to the server
  service = new NotificationService(cfg, events, server, logger);

  const notificationEventListener = async (msg: any, context: any, config: any, eventName: string): Promise<any> => {
    if (eventName === SEND_MAIL_EVENT) {
      const notificationObj = msg;
      const notification: Notification = new Notification(cfg, notificationObj);
      try {
        await service.sendNotification(msg);
      } catch (err) {
        logger.error('Error while sending notification; adding message to pending notifications');
        service.pendingQueue.push({
          transport: 'email',
          notification
        });
      }
    }
    else if (eventName === HEALTH_CHECK_CMD_EVENT || eventName === VERSION_CMD_EVENT) {
      await cis.command(msg, context);
    }
  };

  let externalJobFiles;
  try {
    externalJobFiles = fs.readdirSync(process.env.EXTERNAL_JOBS_DIR || './lib/jobs');
  } catch (err) {
    if (err.message.includes('no such file or directory')) {
      logger.info('No files for external job processors found');
    } else {
      logger.error('Error reading jobs files');
    }
  }
  if (externalJobFiles && externalJobFiles.length > 0) {
    externalJobFiles.forEach( async (externalFile) => {
      if (externalFile.endsWith('.js') || externalFile.endsWith('.cjs') ) {
        let require_dir = './jobs/';
        if (process.env.EXTERNAL_JOBS_REQUIRE_DIR) {
          require_dir = process.env.EXTERNAL_JOBS_REQUIRE_DIR;
        }
        // check for double default
        const fileImport = await import(require_dir + externalFile);
        if(fileImport?.default?.default) {
          (async () => (await import(require_dir + externalFile)).default.default(cfg, logger, events, service, runWorker))().catch(err => {
            logger.error(`Error scheduling external job ${externalFile}`, { err: err.message });
          });
        } else {
          (async () => (await import(require_dir + externalFile)).default(cfg, logger, events, runWorker))().catch(err => {
            logger.error(`Error scheduling external job ${externalFile}`, { err: err.message });
          });
        }
      }
    });
  }
  // Subscribe to "notification_req" topic so that
  // when a message arrives on it, to send out the notification.
  // (topic name is "notification_req" and eventName is "sendEmail")
  const topicTypes = _.keys(kafkaCfg.topics);
  for (const topicType of topicTypes) {
    const topicName = kafkaCfg.topics[topicType].topic;
    const topic: Topic = await events.topic(topicName);
    const offsetValue = await offsetStore.getOffset(topicName);
    logger.info(`subscribing to topic ${topicName} with offset value`, { offset: Number(offsetValue) });
    if (kafkaCfg.topics[topicType].events) {
      const eventNames = kafkaCfg.topics[topicType].events;
      for (const eventName of eventNames) {
        await topic.on(eventName, notificationEventListener,
          { startingOffset: offsetValue });
      }
    }
  }

  await server.bind(serviceNamesCfg.notification_req, {
    service: NotificationReqServiceDefinition,
    implementation: service
  } as BindConfig<NotificationReqServiceDefinition>);

  // Add ReflectionService
  const reflectionServiceName = serviceNamesCfg.reflection;
  const reflectionService = buildReflectionService([{
    descriptor: NotificationReqMeta.fileDescriptor
  }, {
    descriptor: CommandInterfaceMeta.fileDescriptor
  }]);
  await server.bind(reflectionServiceName, {
    service: ServerReflectionService,
    implementation: reflectionService
  });

  await server.bind(serviceNamesCfg.health, {
    service: HealthDefinition,
    implementation: new Health(cis)
  } as BindConfig<HealthDefinition>);

  await server.start();
  logger.info('Server started successfully');
  return service;
};

export const stop = async (): Promise<any> => {
  await server.stop();
  await events.stop();
  await offsetStore.stop();
};
