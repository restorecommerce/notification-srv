'use strict';
import * as co from 'co';
import * as _ from 'lodash';
// microservice
import * as chassis from '@restorecommerce/chassis-srv';
import * as cisr from '@restorecommerce/command-service-interface';
import * as Logger from '@restorecommerce/logger';
import * as sconfig from '@restorecommerce/service-config';
import * as setup from './lib/setup';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Notification } from './lib/notification';

const SEND_MAIL_EVENT = 'sendEmail';
const QUEUED_EVENT = 'queuedJob';
const TRIGGER_MAIL_CMD_EVENT = 'triggerMailCommand';
const HEALTH_CHECK_CMD_EVENT = 'healthCheckCommand';
const HEALTH_CHECK_RES_EVENT = 'healthCheckResponse';

let server: chassis.Server;
let service;
let cis: cisr.CommandInterfaceService;
let events: Events;

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
 * starting/stopping the actual server
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
  } else {
    throw new Error('Kafka not available');
  }

  const that = this;
  const commandTopicName = kafkaCfg.topics.command.topic;
  const jobTopicName = kafkaCfg.topics.jobs.topic;
  const commandTopic: Topic = events.topic(commandTopicName);
  const jobTopic: Topic = events.topic(jobTopicName);
  const notificationEvents: Array<string> = kafkaCfg.notificationEvents;
  const eventSetup = {
    [commandTopicName]: {
      topic: commandTopic,
      events: {}
    }
  };

  // all notification jobs have a generic mechanism
  // 1. 'queued' event is sent from scheduling service containing an event name
  // 2. If the event name is among the possible notification events, an event msg is
  //    sent to Kafka
  // 3. A 'done' event is posted to notify the scheduling service that the pending job
  //    is finished and may be deleted from the database.
  // 4. The listening services are triggered by the event and generate their specific notifications.
  for (let event of notificationEvents) {
    eventSetup[commandTopicName].events[event] = async (message: any, context: any, config: any, eventName: string) => {
      // Mark this job as completed and trigger done event
      const jobDoneObj = {
        id: message.id,
        schedule_type: message.schedule_type,
        job_resource_id: message.job_resource_id,
        job_unique_name: message.job_unique_name
      };
      // Emit the response back to Job Topic.
      await jobTopic.emit('done', jobDoneObj);
      return {};
    };
  }

  // exposing commands as gRPC methods through chassis
  // as 'commandinterface'
  cis = new cisr.CommandInterfaceService(server, eventSetup, cfg.get(), logger);
  await co(server.bind('commandinterface', cis));

  const mailNotificationJob = kafkaCfg.mailNotificationJob;
  let notificationEventListener = async function eventListener(msg: any, context: any,
    config: any, eventName: string): Promise<any> {
    let notificationObj = msg;
    if (eventName === SEND_MAIL_EVENT) {
      const notification: Notification = new Notification(cfg, notificationObj);
      await notification.send('email', logger);
    }
    else if (eventName === QUEUED_EVENT) {
      if (notificationObj && notificationObj.name == mailNotificationJob) {
        let notificationRequest = {};
        for (let i = 0; i < notificationObj.data.length; i++) {
          if (notificationObj.data[i].type_url &&
            notificationObj.data[i].value) {
            let value = Buffer.from(notificationObj.data[i].value, 'base64')
              .toString('ascii');
            let key = notificationObj.data[i].type_url;
            notificationRequest[key] = value;
          }
        }
        notificationRequest['id'] = notificationObj.id;
        notificationRequest['schedule_type'] = notificationObj.schedule_type;
        notificationRequest['job_resource_id'] = notificationObj.job_resource_id;
        notificationRequest['job_unique_name'] = notificationObj.job_unique_name;
        await cis.sendMailNotification(notificationRequest);
      }
    }
    // No scheduled job directly trigger sendMail command
    else if (eventName === TRIGGER_MAIL_CMD_EVENT) {
      await cis.sendMailNotification(notificationObj);
    }
    else if (eventName === HEALTH_CHECK_CMD_EVENT) {
      if (notificationObj && (notificationObj.service ===
        'restore-notification-srv')) {
        const serviceStatus = cis.check(notificationObj);
        const healthCheckTopic: Topic = events.topic(commandTopicName);
        await healthCheckTopic.emit(HEALTH_CHECK_RES_EVENT,
          serviceStatus);
      }
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
    if (kafkaCfg.topics[topicType].events) {
      const eventNames = kafkaCfg.topics[topicType].events;
      for (let eventName of eventNames) {
        await topic.on(eventName, notificationEventListener);
      }
    }
  }

  await co(server.bind('restore-notification-srv', service));
  await co(server.start());

  return service;
}

export async function end(): Promise<any> {
  await co(server.end());
  await events.stop();
}

if (require.main === module) {
  start().catch((err) => {
    console.error('client error', err.stack);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    end().catch((err) => {
      console.error('shutdown error', err);
      process.exit(1);
    });
  });
}
