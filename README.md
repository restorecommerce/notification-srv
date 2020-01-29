# notification-srv

[![Build Status][build]](https://travis-ci.org/restorecommerce/notification-srv?branch=master)[![Dependencies][depend]](https://david-dm.org/restorecommerce/notification-srv)[![Coverage Status][cover]](https://coveralls.io/github/restorecommerce/notification-srv?branch=master)

[build]: http://img.shields.io/travis/restorecommerce/notification-srv/master.svg?style=flat-square
[depend]: https://img.shields.io/david/restorecommerce/notification-srv.svg?style=flat-square
[cover]: http://img.shields.io/coveralls/restorecommerce/notification-srv/master.svg?style=flat-square

A microservice which sends notifications through different channels. Available channels are:

- Email
- Log (via [winston](httshttps://github.com/winstonjs/winston) or classic console)

Unimplemented channels as of now are:

- Slack
- Mattermost
- SMS

The service subscribes to `notification`-related topic using using [kafka-client](https://github.com/restorecommerce/kafka-client) and sends messages based on events on these topics. It is also possible to initiate notification requests directly through its [gRPC](https://grpc.io/docs/) interface, which is exposed using [chassis-srv](https://github.com/restorecommerce/chassis-srv). Internally the microservice uses the [mailer](https://github.com/restorecommerce/mailer) module for sending email notifications which is a wrapper for [nodemailer](https://github.com/nodemailer/nodemailer).

## Configuration

The mail server configurations can be set in `server:mailer` in the [`config.json`](#cfg/config.json) file.

- `host`: hostname of mail server
- `port`: port of mail server to connect to
- `auth.user`: user name for mail server
- `auth.pass`: password for mail server
- `address`: specifies the from address for every message

Alternatively the credentials for the mail server `auth.user` and `auth.pass` can be added as separate resource [`Credential`](https://github.com/restorecommerce/protos/blob/master/io/restorecommerce/credential.proto#L30) resource using [`resources-srv`](https://github.com/restorecommerce/resource-srv).

## gRPC Interface

This microservice exposes the below gRPC endpoint.

### `Send`

This is a generic operation which can be invoked to send any type of notifications. Requests are performed providing `io.restorecommerce.notification.Notification` protobuf message as input and responses are a `google.protobuf.Empty` message.

A `io.restorecommerce.notification.Notification` message can have the following data fields:

| Field | Type | Description | Email | Log |
| ----- | ---- | ----- | ----------- |--------|
| email | `io.restorecommerce.notification.Email` | email channel properties | required | n/a |
| log | `io.restorecommerce.notification.Log` | log channel properties | n/a | required |
| subject | string | URL of a hbs template | required | n/a |
| body | string | URL of a hbs template| required | required |
| transport | string | Directly declares the transportation channel. Possible values: `email` or `log` | required | required |
| provider | bool | Further specifies the chosen transport. Example: use `winston` when transport is set to `log` | optional | optional |
| attachments | []`io.restorecommerce.notification.Attachment` | An array of attachment objects, see below | optional | n/a |

`io.restorecommerce.notification.Email`

| Field | Type | Description | Email | Log |
| ----- | ---- | ----- | ----------- |--------|
| to | string [ ] | an array of recipients email addresses that will appear on the to: field | optional | n/a |
| cc | string [ ] | an array of recipients email addresses that will appear on the cc: field | optional | n/a |
| bcc | string [ ] |  an array of recipients email addresses that will appear on the bcc: field | optional | n/a |
| replyto | string |  If set, the outgoing mail will have this replyTo header set | optional | n/a |

`io.restorecommerce.notification.Log`

| Field | Type | Description | Email | Log |
| ----- | ---- | ----- | ----------- |--------|
| level | string | Logging level ex: `info` | n/a | required |

Attachments may be used in case of email notifications. Attachment properties are based on the standard [nodemailer API](https://community.nodemailer.com/using-attachments/):

`io.restorecommerce.notification.Attachment`

| Field | Type | Description | Email | Log |
| ----- | ---- | ----- | ----------- |--------|
| filename | string | filename to be reported as the name of the attached file, use of unicode is allowed. If you do not want to use a filename, set this value as false, otherwise a filename is generated automatically | required | n/a |
| text | string | String, Buffer or a Stream contents for the attachment | required | n/a |
| buffer | bytes | binary data eg.: images | required | n/a |
| path | string | path to a file or an URL (data uris are allowed as well) if you want to stream the file instead of including it (better for larger attachments) | required | n/a |
| content_type | string | optional content type for the attachment, if not set will be derived from the filename property | required | n/a |
| content_disposition | string | optional content disposition type for the attachment, defaults to `attachment` | required | n/a |
| cid | string | optional content ID for using inline images in HTML message source | required | n/a |
| encoding | string | If set and content is string, then encodes the content to a Buffer using the specified encoding. Example values: base64, hex, binary etc. Useful if you want to use binary attachments in a JSON formatted e-mail object | required | n/a |

Because of limitations in the protobuf protocol, there is single hatch:
`content` should be specified as one of the attributes `text` (for strings) or `buffer` (raw bytes, like images).

Textual attachments are appendend in the mail as-is, while binary attachments are converted to base64 and then included (see [tests](test/)).

## Kafka Events

This microservice subscribes to the following Kafka events by topic:

| Topic Name | Event Name | Description |
| ----------- | ------------ | ------------- |
| `io.restorecommerce.command`      | `healthCheckCommand` | to get system health check |
|                                   | `versionCommand` | to get system version |
| `io.restorecommerce.notitication` | `sendEmail` | to send email |

List of events emitted to Kafka by this microservice for below topics:

| Topic Name | Event Name | Description |
| ----------- | ------------ | ------------- |
| `io.restorecommerce.command` | `healthCheckResponse` | system health check response |
|                              | `versionResponse` | system version response |

`sendEmail` events are based on the same protobuf message as the gRPC call for the `Send` endpoint.

## Chassis Service

This service uses [chassis-srv](http://github.com/restorecommerce/chassis-srv), a base module for [restorecommerce](https://github.com/restorecommerce) microservices, in order to provide the following functionalities:

- exposure of all previously mentioned gRPC endpoints
- implementation of a [command-interface](https://github.com/restorecommerce/chassis-srv/blob/master/command-interface.md) which
provides endpoints for retrieving the system status and version information. These endpoints can be called via gRPC or Kafka events (through the `io.restorecommerce.command` topic).
- stores the offset values for Kafka topics at regular intervals to [Redis](https://redis.io/).

## Development

### Tests

See [tests](test/). To execute the tests a running instance of [Kafka](https://kafka.apache.org/) and [Redis](https://redis.io/) are needed.
Refer to [System](https://github.com/restorecommerce/system) repository to start the backing-services before running the tests.

- To run tests

```sh
npm run test
```

**Note**: although any kind of gRPC client can be used to connect to these endpoints, the tests make use of the [grpc-client](https://github.com/restorecommerce/grpc-client),
a `restorecommerce` module which allows an application to connect to multiple gRPC endpoints with custom middleware, loadbalancing and retry/timeout support.

## Running as Docker Container

This service depends on a set of _backing services_ that can be started using a
dedicated [docker compose definition](https://github.com/restorecommerce/system).

```sh
docker run \
 --name restorecommerce_notification_srv \
 --hostname notification-srv \
 --network=system_test \
 -e NODE_ENV=production \
 -p 50052:50052 \
 restorecommerce/notification-srv
```

## Running Locally

Install dependencies

```sh
npm install
```

Build service

```sh
# compile the code
npm run build
```

Start service

```sh
# run compiled service
npm start
```