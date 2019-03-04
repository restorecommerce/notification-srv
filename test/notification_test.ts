import * as fs from 'fs';
import * as assert from 'assert';
import { Notification } from '../lib/notification';
import * as sconfig from '@restorecommerce/service-config';
import { Service, start, stop } from './../service';
import { Events } from '@restorecommerce/kafka-client';
import { Client } from '@restorecommerce/grpc-client';

let service: Service;
let cfg: any;
let events: Events;
const mailBody = fs.readFileSync('./test/fixtures/test.html', 'utf-8');

/**
 * NOTE: A running instance of Kafka and redis is needed to execute below test.
 */

describe('testing: send', () => {

  before(async function init() {
    cfg = sconfig(process.cwd() + '/test');
    service = await start(cfg);
    events = new Events(cfg.get('events:kafka'), service.logger);
    await events.start();
  });

  after(async function stopServer() {
    await stop();
    await events.stop();
  });

  it('should log a message', async function sendLogMessage() {
    const notification: Notification = new Notification(cfg, {
      notifyee: console,
      body: 'log with from user: test@web.de',
      transport: 'log',
      provider: 'winston',
      level: 'info'
    });
    // empty response
    const response = {};
    const result = await notification.send('log', service.logger);
    assert.deepEqual(response, result);
  });

  it('should send an email', async function sendEmailMessage() {
    const notification: Notification = new Notification(cfg, {
      notifyee: 'test@web.de',
      body: mailBody,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@web.de'
    });
    const result = await notification.send('email', service.logger);
    assert(result);
  });

  it('should send an email through grpc', async function sendEmailGRPC() {
    const client: Client = new Client(cfg.get('client:notificationService'), service.logger);
    const clientService = await client.connect();
    const notification = {
      notifyee: 'test@example.com',
      body: mailBody,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@example.com'
    };
    const result = await clientService.send(notification, service.logger);
    assert(result);
    await client.end();
  });

  it('should queue failed emails', async function () {
    let previousEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
    const client: Client = new Client(cfg.get('client:notificationService'), service.logger);
    const clientService = await client.connect();
    const notification = {
      notifyee: 'test@example.com',
      body: mailBody,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@example.com'
    };
    const result = await clientService.send(notification, service.logger);
    assert(result);
    assert.deepStrictEqual(service.pendingQueue.length, 1);
    await client.end();
    process.env.NODE_ENV = previousEnv;
  });

  it('should send mail notification to kafka', async function sendKafkaMail() {
    const notification = {
      notifyee: 'test@example.com',
      body: mailBody,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@example.com'
    };
    const topic = events.topic('io.restorecommerce.notification');
    const offset = await topic.$offset(-1);
    await topic.emit('sendEmail', notification);
    const newOffset = await topic.$offset(-1);
    assert.equal(offset + 1, newOffset);
  });

  it('should send an email with attachments', async function sendAttachment() {
    const notification = new Notification(cfg, {
      notifyee: 'test@example.com',
      body: mailBody,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@example.com',
      attachments: [{
        filename: 'test.txt',
        text: 'this is an example text.'
      }]
    });
    const result = await notification.send('email', service.logger);
    assert(result);
    assert(result.response);
    assert(/test.txt/.test(result.response.toString()));
  });

  it('should send an email with image URLs', async function sendImage() {
    const imgUrl = 'https://avatars2.githubusercontent.com/u/8339525?v=3&s=200';
    const mailBodyWithURL = fs.readFileSync('./test/fixtures/test_with_image_url.html');

    const notification: Notification = new Notification(cfg, {
      notifyee: 'test@web.de',
      body: mailBodyWithURL,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@web.de',
      attachments: [{
        filename: 'test.png',
        path: imgUrl,
        cid: imgUrl
      }]
    });
    const result = await notification.send('email', service.logger);
    assert(result);
    assert(result.response);
    assert(/test.png/.test(result.response.toString()));
  });

  it('should send an email with image buffers', async function sendImage() {
    const mailBodyWithBuffer = fs.readFileSync('./test/fixtures/test_with_image_buffer.html');
    const notification = new Notification(cfg, {
      notifyee: 'test@web.de',
      body: mailBodyWithBuffer,
      subject: 'info for test@web.de',
      transport: 'email',
      target: 'test@web.de',
      attachments: [{
        filename: 'rc-logo.png',
        buffer: new Buffer(fs.readFileSync('./test/fixtures/rc-logo.png')),
        cid: 'rc-logo.png'
      }]
    });
    const result = await notification.send('email', service.logger);
    assert(result);
    assert(result.response);
    assert(/rc-logo.png/.test(result.response.toString()));
  });
});
