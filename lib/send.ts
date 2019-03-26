import * as Mailer from '@restorecommerce/mailer';
import { Notification } from './notification';

/**
 * log a bare notification using a chosen logging mechanism
 * @param {Notification} notification
 * @param {any } logger
 */
export async function log(notification: Notification, logger?: any): Promise<any> {
  const { log, body } = notification;
  if (!logger) {
    logger = console;
  }
  logger.log(log.level, body);
  return {}; // success-placeholder
}

/**
 * send a notification via email
 * @param {Notification} notification
 * @param {any} cfg
 * @param {any} logger
 */
export function email(notification: Notification, cfg: any, logger: any): any {

  let { email, body, subject, replyto, attachments, bcc, cc } = notification;

  const mailConf = cfg.get('server:mailer');
  mailConf.logger = logger;
  const mailer = new Mailer(mailConf);
  const mail = {
    from: mailConf.address,
    to: email.to,
    subject,
    html: body,
    replyTo: replyto,
    attachments: [],
    bcc: [],
    cc: []

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

  if (cc && cc != []) {
    mail.cc = email.cc;
  }

  if (bcc && bcc !== []) {
    mail.bcc = email.bcc;
  }
  return mailer.send(mail);
}

export async function slack(notification: Notification): Promise<any> {
  return true;
}

export async function sms(notification: Notification): Promise<any> {
  return true;
}
