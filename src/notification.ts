import * as _ from 'lodash';
import * as send from './send';
import { Email, Log } from './interfaces';

const Attrs = [
  'log',
  'email',
  'subject',
  'body',
  'transport',
  'provider',
  'replyto',
  'target',
  'attachments',
  'level'
];

export class Notification {
  log: Log;
  email: Email;
  subject: any;
  body: any;
  transport: string;
  attachments: any;
  replyto: string;
  cfg: any;
  level: string;
  bcc: string[];
  cc: string[];
  constructor(cfg: any, opts?: any) {
    this.cfg = cfg;
    _.extend(this, _.pick(opts, ...Attrs));
  }

  /**
   * check all relevant attributes for correctness, where every possible
   * channel requires *different* attributes.
   *
   * channel "email":
   * - subject, body == IRI to template
   * - layout == template, surrounding body
   *
   * channel "log":
   * - there is only a body template without layout
   * - subject template is ignored
   *
   */
  isValid(): boolean {
    return true;
  }

  /**
   * send the notification via the specified channel
   * @param {any} channegit l
   * @param {any} logger
   */
  async send(channel: any, logger: any = {}): Promise<any> {
    this.transport = !!channel ? channel : this.transport;
    if (this.transport === 'email') {
      return send.email(this, this.cfg, logger);
    }
    if (this.transport === 'slack') {
      return send.slack(this);
    }
    if (this.transport === 'sms') {
      return send.sms(this);
    }
    return send.log(this, logger);
  }
}
