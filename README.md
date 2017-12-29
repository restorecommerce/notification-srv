# notification-srv

<img src="http://img.shields.io/npm/v/%40restorecommerce%2Fnotification%2Dsrv.svg?style=flat-square" alt="">[![Build Status][build]](https://travis-ci.org/restorecommerce/notification-srv?branch=master)[![Dependencies][depend]](https://david-dm.org/restorecommerce/notification-srv)[![Coverage Status][cover]](https://coveralls.io/github/restorecommerce/notification-srv?branch=master)

[version]: http://img.shields.io/npm/v/notification-srv.svg?style=flat-square
[build]: http://img.shields.io/travis/restorecommerce/notification-srv/master.svg?style=flat-square
[depend]: https://img.shields.io/david/restorecommerce/notification-srv.svg?style=flat-square
[cover]: http://img.shields.io/coveralls/restorecommerce/notification-srv/master.svg?style=flat-square

A generic microservice which forwards notifications to different types of channels. Currently, the implemented channels are:
- Email
- Log (via winston or classic console)

Unimplemented channels as of now are:
- Slack
- SMS

The service should subscribe to any `notification`-related topic from Kafka and trigger message-forwarding actions based on events, using [kafka-client](https://github.com/restorecommerce/kafka-client). It's also possible to perform notification requests directly through the provided [gRPC](https://grpc.io/docs/) interface, which is exposed using [chassis-srv](https://github.com/restorecommerce/chassis-srv). Internally the microservice uses the [mailer](https://github.com/restorecommerce/mailer) module for sending email notifications which is a wrapper for [nodemailer](https://github.com/nodemailer/nodemailer). The mail server configurations can be set in `server:mailer` in config.json(#cfg/config.json) file.

## gRPC Interface

This microservice exposes the below gRPC endpoint.

### Send
This is a generic operation which can be invoked to send any type of notifications. Requests are performed providing `io.restorecommerce.notification.Notification` protobuf message as input and responses are a `google.protobuf.Empty` message.

A `io.restorecommerce.notification.Notification` message can have the following data fields:

| Field | Type | Description | Email | Logging |
| ----- | ---- | ----- | ----------- |--------|
| notifyee | string | IRI of a User or Organization | required | --- |
| subject | string | IRI of a hbs template | required | --- |
| body | string | IRI of a hbs template| required | required |
| transport | string | Directly declares the transportation channel. Possible values: `'email'` or `'log'` | optional | optional |
| provider | bool | Further specifies the chosen transport. Example: use 'winston' when transport is set to 'log' | optional | optional |
| replyto | string | If set, the outgoing mail will have this replyTo header set | optional | --- |
| target | string | Email address. If this is set, the notification will be sent to this adress directly, skipping any notifyee lookup | optional | --- |
| attachments | []Attachment | An array of attachment objects, see below | optional | --- |

Attachments may be used in case of email notifications. Attachment properties are based on the standard [nodemailer API](https://community.nodemailer.com/using-attachments/):

`io.restorecommerce.notification.Attachment`

| Field | Type | Description | Email | Logging |
| ----- | ---- | ----- | ----------- |--------|
| filename | string | filename to be reported as the name of the attached file, use of unicode is allowed. If you do not want to use a filename, set this value as false, otherwise a filename is generated automatically | required | --- |
| text | string | String, Buffer or a Stream contents for the attachment | required | --- |
| buffer | bytes | binary data eg.: images | required | --- |
| path | string | path to a file or an URL (data uris are allowed as well) if you want to stream the file instead of including it (better for larger attachments) | required | --- |
| content_type | string | optional content type for the attachment, if not set will be derived from the filename property | required | --- |
| content_disposition | string | optional content disposition type for the attachment, defaults to ‘attachment’ | required | --- |
| cid | string | optional content id for using inline images in HTML message source | required | --- |
| encoding | string | If set and content is string, then encodes the content to a Buffer using the specified encoding. Example values: base64, hex, binary etc. Useful if you want to use binary attachments in a JSON formatted e-mail object | required | --- |

Because of limitations in the protobuf protocol, there is single hatch:

> `content` should be specified as one of the attributes `text` (for strings) or `buffer` (raw bytes, like images).

Textual attachments are appendend in the mail as-is, while binary attachments are converted to base64 and then included (see [tests](test/)).

## Kafka Events

This microservice subscribes to the following Kafka events by topic:
- io.restorecommerce.command
  - triggerMailCommand
  - healthCheckCommand
- io.restorecommerce.jobs
  - queuedJob
- io.restorecommerce.notitication
  - sendEmail

List of events emitted to Kafka by this microservice for below topics:
- io.restorecommerce.command
  - healthCheckResponse
- io.restorecommerce.jobs
  - done

`sendEmail` events are based on the same protobuf message as the gRPC call for the `Send` endpoint.
`queuedJob` events are emitted to Kafka by the Scheduling Service to schedule a Job (ex: to trigger mail notification periodically) and upon successful processing of the job by
this microservice a `done` event is emitted. Refer [scheduling-srv](https://github.com/restorecommerce/scheduling-srv) for more details regarding the protobuf message structure for the Job.

## Shared Interface

This microservice implements a shared [command-interface](https://github.com/restorecommerce/command-interface) which
provides endpoints for retrieving the system status and resetting/restoring the system in case of failure. These endpoints can be called via gRPC or Kafka events (through the `io.restorecommerce.command` topic).
For usage details please see [command-interface tests](https://github.com/restorecommerce/command-interface/tree/master/test).


## Usage

See [tests](test/).


**Note**: although any kind of gRPC client can be used to connect to these endpoints, the tests make use of the [grpc-client](https://github.com/restorecommerce/grpc-client),
a `restorecommerce` module which allows an application to connect to multiple gRPC endpoints with custom middleware, loadbalancing and retry/timeout support.
