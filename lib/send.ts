'use strict';

import * as Mailer from '@restorecommerce/mailer';
import { Notification } from './notification';

/**
 * log a bare notification using a chosen logging mechanism
 * @param {Notification} notification
 * @param {any } logger
 */
export async function log(notification: Notification, logger?: any): Promise<any> {
  const { body } = notification;
  if (!logger) {
    logger = console;
  }
  logger.log(body);
  return await {}; // success-placeholder
}

/**
 * send a notification via email
 * @param {Notification} notification
 * @param {any} cfg
 * @param {any} logger
 */
export function email(notification: Notification, cfg: any, logger: any): any {
  let { notifyee, body, subject, replyto, attachments } = notification;

  const target = notifyee.email;
  const mailConf = cfg.get('server:mailer');
  mailConf.logger = logger;
  const mailer = new Mailer(mailConf);
  const mail = {
    from: mailConf.address,
    to: notification.notifyee,
    subject: notification.subject,
    html: notification.body,
    replyTo: notification.replyto,
    attachments: []
  };

  if (attachments && attachments !== []) {
    const list = [];
    for (const a of attachments) {
      if (a.text) a.content = a.text;
      if (a.buffer) a.content = a.buffer;
      list.push(a);
    }
    mail.attachments = list;
  }

  return mailer.send(mail);
}

export async function slack(notification: Notification): Promise<any> {
  return true;
}

export async function sms(notification: Notification): Promise<any> {
  return true;
}
