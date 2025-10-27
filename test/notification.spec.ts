import fs from 'node:fs';
import assert from 'assert';
import { createServiceConfig } from '@restorecommerce/service-config';
import { Events } from '@restorecommerce/kafka-client';
import { createClient, createChannel } from '@restorecommerce/grpc-client';
import { Notification } from '../src/notification';
import { NotificationService, start, stop } from '../src/service';
import { 
  NotificationReqServiceDefinition,
  NotificationReqServiceClient
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/notification_req.js';

// NOTE: A running instance of Kafka and redis is needed to execute below test.
const cfg = createServiceConfig(process.cwd() + '/test');
const mailBody = fs.readFileSync('./test/fixtures/test.html', 'utf-8');

let service: NotificationService;
let events: Events;

// If default cfg is not provided assume a
// real email configuration is being tested
let defaultCfg: boolean;
const hostCfg = cfg.get('server:mailer:host');
const emailAddr = cfg.get('server:mailer:destinationAddress');
if (hostCfg === 'mail.example.com') {
  console.log('Using default email server configuration.');
  defaultCfg = true;
} else {
  console.log('Using custom email server configuration.');
  defaultCfg = false;
}

describe('testing: send', () => {
  before(async function init(): Promise<void> {
    service = await start(cfg);
    events = new Events(cfg.get('events:kafka'), service.logger);
    events = new Events({
      ...cfg.get('events:kafka'),
      groupId: 'restore-notification-req-srv-test-runner',
      kafka: {
        ...cfg.get('events:kafka:kafka'),
      }
    }, service.logger);
    await events.start();
  });

  after(async function stopServer(): Promise<void> {
    await stop();
    await events.stop();
  });

  it('should log a message', async function sendLogMessage(): Promise<void> {
    const notification: Notification = new Notification(cfg, {
      log: {
        level: 'info'
      },
      body: 'log with from user: test@web.de',
      transport: 'log',
      provider: 'winston',
    });
    // empty response
    const response = {};
    const result = await notification.send('log', service.logger);
    assert.deepEqual(response, result);
  });

  it('should send an email', async function sendEmailMessage(): Promise<void> {
    const notification = new Notification(cfg, {
      email: {
        to: [emailAddr]
      },
      body: mailBody,
      subject: 'should send an email',
      transport: 'email',
    });

    if (defaultCfg) {
      const result = await notification.send('email', service.logger);
      assert(result);
    } else {
      let previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
      const result = await notification.send('email', service.logger);
      assert(result);
      process.env.NODE_ENV = previousEnv;
    }
  });

  it('should send an email through grpc', async function sendEmailGRPC(): Promise<void> {
    const notificationReqCfg = cfg.get('client:notificationReqService');
    const channel = createChannel(notificationReqCfg.address);
    const logger = service.logger;
    const clientService: NotificationReqServiceClient = createClient({
      ...notificationReqCfg,
      logger
    }, NotificationReqServiceDefinition, channel);
    const notification = {
      email: {
        to: [emailAddr]
      },
      body: mailBody,
      subject: 'should send an email through grpc',
      transport: 'email',
    };

    if (defaultCfg) {
      const result = await clientService.send(notification);
      assert(result);
    } else {
      let previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
      const result = await clientService.send(notification);
      assert(result);
      process.env.NODE_ENV = previousEnv;
    }
  });

  it('should queue failed emails', async function (): Promise<void> {
    let previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
    const notificationReqCfg = cfg.get('client:notificationReqService');
    const channel = createChannel(notificationReqCfg.address);
    const logger = service.logger;
    const clientService: NotificationReqServiceClient = createClient({
      ...notificationReqCfg,
      logger
    }, NotificationReqServiceDefinition, channel);
    const notification = {
      email: {
        to: [emailAddr]
      },
      body: mailBody,
      subject: 'should queue failed emails',
      transport: 'email',
    };

    if (defaultCfg) {
      const result = await clientService.send(notification);
      assert(result);
      assert.deepStrictEqual(service.pendingQueue.length, 1);
    } else {
      // restart server with different mailer cfg
      // so that we prevent sending an email
      await stop();
      let prevHost = cfg.get('server:mailer:host');
      (cfg as any).set('server:mailer:host', 'mail.example.com');
      service = await start(cfg);
      const result = await clientService.send(notification);
      assert(result);
      assert.deepStrictEqual(service.pendingQueue.length, 1);
      // restart server again with prev cfg
      await stop();
      (cfg as any).set('server:mailer:host', prevHost);
      service = await start(cfg);
    }
    process.env.NODE_ENV = previousEnv;
  });

  it('should send mail notification to kafka', async function sendKafkaMail(): Promise<void> {
    const notification = {
      email: {
        to: [emailAddr]
      },
      body: mailBody,
      subject: 'should send mail notification to kafka',
      transport: 'email'
    };
    const topic = await events.topic('io.restorecommerce.notification_req');
    const offset = await topic.$offset(BigInt(-1));
    await topic.emit('sendEmail', notification);
    const newOffset = await topic.$offset(BigInt(-1));
    assert.equal(Number(offset) + 1, newOffset);
  });

  it('should send an email with attachments', async function sendAttachment(): Promise<void> {
    const notification = new Notification(cfg, {
      email: {
        to: [emailAddr]
      },
      body: mailBody,
      subject: 'should send an email with attachments',
      transport: 'email',
      target: 'test@example.com',
      attachments: [{
        filename: 'test.txt',
        text: 'this is an example text.'
      }]
    });

    if (defaultCfg) {
      const result = await notification.send('email', service.logger);
      assert(result);
      assert(result.response);
      assert(/test.txt/.test(result.response.toString()));
    } else {
      let previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
      const result = await notification.send('email', service.logger);
      assert(result);
      assert(result.response);
      let smtpResponse = result.response.split(" ")[0];
      assert(/250/.test(smtpResponse)); // SMTP Response 250
      process.env.NODE_ENV = previousEnv;
    }
  });

  it('should send an email with image URLs', async function sendImage(): Promise<void> {
    const imgUrl = 'https://avatars2.githubusercontent.com/u/8339525?v=3&s=200';
    const mailBodyWithURL = fs.readFileSync('./test/fixtures/test_with_image_url.html');

    const notification: Notification = new Notification(cfg, {
      email: {
        to: [emailAddr]
      },
      body: mailBodyWithURL,
      subject: 'should send an email with image URLs',
      transport: 'email',
      target: 'test@web.de',
      attachments: [{
        filename: 'test.png',
        path: imgUrl,
        cid: imgUrl
      }]
    });

    if (defaultCfg) {
      const result = await notification.send('email', service.logger);
      assert(result);
      assert(result.response);
      assert(/test.png/.test(result.response.toString()));
    } else {
      let previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
      const result = await notification.send('email', service.logger);
      assert(result);
      assert(result.response);
      let smtpResponse = result.response.split(" ")[0];
      assert(/250/.test(smtpResponse)); // SMTP Response 250
      process.env.NODE_ENV = previousEnv;
    }
  });

  it('should send an email with image buffers', async function sendImage(): Promise<void> {
    const mailBodyWithBuffer = fs.readFileSync('./test/fixtures/test_with_image_buffer.html');
    const notification = new Notification(cfg, {
      email: {
        to: [emailAddr]
      },
      body: mailBodyWithBuffer,
      subject: 'should send an email with image buffers',
      transport: 'email',
      target: 'test@web.de',
      attachments: [{
        filename: 'rc-logo.png',
        buffer: Buffer.from(fs.readFileSync('./test/fixtures/rc-logo.png')),
        cid: 'rc-logo.png'
      }]
    });

    if (defaultCfg) {
      const result = await notification.send('email', service.logger);
      assert(result);
      assert(result.response);
      assert(/rc-logo.png/.test(result.response.toString()));
    } else {
      let previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'other'; // overriding env to avoid creating email stub
      const result = await notification.send('email', service.logger);
      assert(result);
      assert(result.response);
      let smtpResponse = result.response.split(" ")[0];
      assert(/250/.test(smtpResponse)); // SMTP Response 250
      process.env.NODE_ENV = previousEnv;
    }
  });
});
