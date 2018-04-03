'use strict';
import * as co from 'co';
import * as _ from 'lodash';
// microservice
import * as chassis from '@restorecommerce/chassis-srv';
import * as Logger from '@restorecommerce/logger';
import * as sconfig from '@restorecommerce/service-config';
import * as setup from './lib/setup';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Notification } from './lib/notification';

const SEND_MAIL_EVENT = 'sendEmail';
const HEALTH_CHECK_CMD_EVENT = 'healthCheckCommand';
const HEALTH_CHECK_RES_EVENT = 'healthCheckResponse';

let server: chassis.Server;
let service;
let events: Events;
let offsetStore: chassis.OffsetStore;

/**
 * Main API for sending notifications.
 * Exposes methods via gRPC.
 */
class Service {
  events: Events;
  server: chassis.Server;
  logger: Logger;
  cfg: any;
  constructor(cfg: any, events: Events, server: chassis.Server, logger: Logger) {
    this.cfg = cfg;
    this.server = server;
    this.logger = logger;
    this.events = events;
  }

  /**
   * helper function which invokes different transport notifications
   * @param request contians the transport channel detail
   * @param context
   */
  async send(request: any, context: any): Promise<any> {
    const transport = request.request.transport;
    if (transport === 'email') {
      await this.sendEmail(request, context);
    } else if (transport == 'log') {
      await this.sendLog(request, context);
    } else {
      this.logger.error('Transport not implemented:', transport);
    }
  }

  /**
   * logs the request message
   * @param request
   * @param context
   */
  async sendLog(request: any, context: any): Promise<any> {
    const { userId, subjectId, bodyId } = request;
    const notification: Notification = new Notification(this.cfg, {
      userId, subjectId, bodyId
    });
    if (!notification.isValid()) {
      throw new Error('invalid or not existing params');
    }
    await notification.send('log');
  }

  /**
   * triggers sending email
   * @param request
   * @param context
   */
  async sendEmail(request: any, context: any): Promise<any> {
    const req = request.request;
    const { body, notifyee, subject, target } = req;
    const notification: Notification = new Notification(this.cfg, {
      notifyee, target, subject, body
    });

    if (!notification.isValid()) {
      throw new Error('invalid or not existing params');
    }
    await notification.send('email', service.logger);
  }
}

/**
 * starting the actual server
 * @param cfg
 */
export async function start(cfg?: any): Promise<any> {
  if (!cfg) {
    cfg = sconfig(process.cwd());
  }
  const logger: any = new Logger(cfg.get('logger'));

  server = new chassis.Server(cfg.get('server'), logger);

  // prepare kafka & events
  let kafkaIsAvailable = false;
  let kafkaCfg;
  try {
    kafkaCfg = cfg.get('events:kafka');
    kafkaIsAvailable = setup.isKafkaAvailable(kafkaCfg);
  } catch (e) {
    kafkaIsAvailable = false;
  }

  if (kafkaIsAvailable) {
    events = new Events(kafkaCfg, logger);
    await events.start();
    offsetStore = new chassis.OffsetStore(events, cfg, logger);
  } else {
    throw new Error('Kafka not available');
  }

  const that = this;
  const commandTopicName = kafkaCfg.topics.command.topic;
  // exposing commands as gRPC methods through chassis
  // as 'commandinterface
  const cis: chassis.ICommandInterface = new chassis.CommandInterface(server, cfg.get(), logger, events);
  const cisName = cfg.get('command-interface:name');
  await server.bind(cisName, cis);

  const mailNotificationJob = kafkaCfg.mailNotificationJob;
  let notificationEventListener = async function eventListener(msg: any, context: any,
    config: any, eventName: string): Promise<any> {
    let notificationObj = msg;
    if (eventName === SEND_MAIL_EVENT) {
      const notification: Notification = new Notification(cfg, notificationObj);
      await notification.send('email', logger);
    }
    else if (eventName === HEALTH_CHECK_CMD_EVENT) {
      await cis.command(msg, context);
    }
  };

  // finally create the service and bind to the server
  service = new Service(cfg, events, server, logger);
  // Subsribe to notification topic to send out notification when the message
  // arrives on notification topic
  // (topic name is notification and eventName is sendEmail)
  const topicTypes = _.keys(kafkaCfg.topics);
  for (let topicType of topicTypes) {
    const topicName = kafkaCfg.topics[topicType].topic;
    const topic: Topic = events.topic(topicName);
    const offsetValue = await offsetStore.getOffset(topicName);
    logger.info('subscribing to topic with offset value', topicName, offsetValue);
    if (kafkaCfg.topics[topicType].events) {
      const eventNames = kafkaCfg.topics[topicType].events;
      for (let eventName of eventNames) {
        await topic.on(eventName, notificationEventListener, offsetValue);
      }
    }
  }

  await server.bind('io-restorecommerce-notification-srv', service);
  await server.start();
  return service;
}

export async function stop(): Promise<any> {
  await server.stop();
  await events.stop();
  await offsetStore.stop();
}

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
