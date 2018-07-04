'use strict';

// dependencies
import * as _ from 'lodash';
import * as send from './send';

const Attrs = [
  'notifyee',
  'subject',
  'body',
  'transport',
  'provider',
  'replyto',
  'target',
  'attachments'
];

export class Notification {
  target: string;
  notifyee: any;
  subject: any;
  body: any;
  transport: string;
  attachments: any;
  replyto: string;
  cfg: any;
  constructor(cfg: any, opts?: any) {
    this.cfg = cfg;
    _.extend(this, _.pick(opts, ...Attrs));
  }

  /**
   * check all relevant attributes for correctness, where every possible
   * channel requires *different* attributes.
   *
   * channel "email":
   * - notifyee == IRI to a user object
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
   * @param {any} channel
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

  /**
   * helper to create UUIDs.
   */
  createUUID(): string {
    function s4(): string {
      return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
      s4() + '-' + s4() + s4() + s4();
  }
}
