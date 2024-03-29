import { Mailer } from '@restorecommerce/mailer';
import { Notification } from './notification.js';
import _ from 'lodash-es';

/**
 * log a bare notification using a chosen logging mechanism
 * @param {Notification} notification
 * @param {any } logger
 */
export const log = async (notification: Notification, logger?: any): Promise<any> => {
  const { log, body } = notification;
  if (!logger) {
    logger = console;
  }
  logger.log(log.level, body);
  return {}; // success-placeholder
};

/**
 * send a notification via email
 * @param {Notification} notification
 * @param {any} cfg
 * @param {any} logger
 */
export const email = (notification: Notification, cfg: any, logger: any): any => {

  let { email, body, subject, replyto, attachments } = notification;

  const mailConf = cfg.get('server:mailer');
  mailConf.logger = logger;
  const mailer = new Mailer(mailConf, {});
  const mail = {
    from: mailConf.address,
    to: email.to,
    subject,
    html: body,
    replyTo: replyto,
    attachments: [],
    cc: email.cc,
    bcc: email.bcc
  };

  if (_.isArray(attachments) && !_.isEmpty(attachments)) {
    const list = [];
    for (const a of attachments) {
      if (a.text) a.content = a.text;
      if (a.buffer) a.content = a.buffer;
      list.push(a);
    }
    mail.attachments = list;
  }

  return mailer.send(mail);
};

export const slack = async (notification: Notification): Promise<any> => {
  return true;
};

export const sms = async (notification: Notification): Promise<any> => {
  return true;
};

