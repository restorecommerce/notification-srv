### 1.2.8 (December 10th, 2023)

- include error code 421 - Error: too many connections for queueing message

### 1.2.7 (November 26th, 2023)

- removed deprecated method in chassis-srv (collection.load)

## 1.2.6 (November 25th, 2023)

- updated dependencies

## 1.2.5 (November 23rd, 2023)

- add redis job store and register job meta for emitting jobDone / jobFailed (for processing pending notifications job) 

## 1.2.4 (November 23rd, 2023)

- added separate queue for processing pending notification jobs

## 1.2.3 (November 21st, 2023)

- up deps

## 1.2.2 (October 9th, 2023)

- up job name

## 1.2.1 (October 7th, 2023)

- added worker for process pending notification job

## 1.2.0 (October 7th, 2023)

- up node and all deps

## 1.1.0 (September 20th, 2023)

- set all fields optional in proto files

## 1.0.2 (July 28th, 2023)

- use server typings

## 1.0.1 (July 26th, 2023)

- updated dependencies

## 1.0.0 (June 20th, 2023)

- major version change (move to full typed client and server, full text search, up all deps)

## 0.3.4 (June 20th, 2023)

- up deps

## 0.3.3 (June 1st, 2023)

- up deps

## 0.3.2 (October 26th, 2022)

- move to full typed client and server, full text search
- up all deps

## 0.3.1 (June 30th, 2022)

- up deps

## 0.3.0 (June 30th, 2022)

- up deps
- mail server credentials - added retry mechanism for reading credentials from resource-srv if its not set up in configuration

## 0.2.12 (February 18th, 2022)

- updated chassis-srv (includes fix for offset store config)

## 0.2.11 (February 14th, 2022)

- updated redis url

## 0.2.10 (February 14th, 2022)

- up dependencies and migrated from ioredis to redis

## 0.2.9 (December 22nd, 2021)

- removed importHelpers flag from tsconfig

### 0.2.8 (December 22nd, 2021)

- updated ts config and added no floating promise rule

### 0.2.7 (December 22nd, 2021)

- updated RC dependencies

## 0.2.6 (December 15th, 2021)

- updated dependencies

## 0.2.5 (December 10th, 2021)

- removed setup topics script

## 0.2.4 (December 9th, 2021)

- up dependencies

## 0.2.3 (October 7th, 2021)

- up protos

## 0.2.2 (September 21st, 2021)

- up RC dependencies

## 0.2.1 (September 13th, 2021)

- up dependencies

## 0.2.0 (August 10th, 2021)

- latest grpc-client
- migraged kafka-client to kafkajs
- chassis-srv using the latest grpc-js and protobufdef loader
- filter changes (removed google.protobuf.struct completely and defined nested proto structure)
- added status object to each item and also overall operation_status.

## 0.1.16 (June 28th, 2021)

- updated node version to 16.3
- updated logger and protos

## 0.1.15 (March 19th, 2021)

- migrated from redis to ioredis
- updated dependencies.

## 0.1.14 (March 11th, 2021)

- updated dependencies.

## 0.1.13 (February 24th, 2021)

- updated logger and srv-config

## 0.1.12 (February 23rd, 2021)

- updated dependencies, node and npm

## 0.1.11 (January 22nd, 2021)

- updated dependencies
- adapted code and configuration to match new notification_req.proto
- updated readme

## 0.1.10 (December 4th, 2020)

- up protos (last_login updated on token)

## 0.1.9 (December 2nd, 2020)

- fix docker image permissions

### 0.1.8 (November 19th, 2020)

- updated dependencies

### 0.1.7 (November 9th, 2020)

- upgrade dependencies and improve logging

### 0.1.6 (October 19th, 2020)

- updated chassis-srv

### 0.1.5 (October 14th, 2020)

- add new grpc healthcheck with readiness probe
- listen on 0.0.0.0 for grpc port
- up acs-client, protos and deps

### 0.1.4 (October 9th, 2020)

- updated Dockerfile with NO_UPDATE_NOTIFIER environment variable

### 0.1.3 (October 3rd, 2020)

- updated restructured protos

### 0.1.2 (August 27th, 2020)

- healthcheck fix, updated dependencies

### 0.1.1 (August 18th, 2020)

- updated logger and node version

### 0.1.0 (July 30th, 2020)

- initial release
