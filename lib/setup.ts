/**
 * Kafka's JS API currently does not support any check whether it is
 * running or which topics are created. To prevent masses of try/catch,
 * check for kafka via the included shell script.
 */
import * as _ from 'lodash';
import * as kafka from 'kafka-node';

/**
 * Check availability of Kafka
 * @param kafkaCfg
 * @param fn call back function
 */
const isKafkaAvailable = function checkKafka(kafkaCfg: any, fn: any): any {
  let connectionString = kafkaCfg.connectionString;
  const topics = kafkaCfg.topics;
  let client = new kafka.Client(connectionString);
  client.once('connect', function (): any {
    client.loadMetadataForTopics([], function (error: any, results: any): any {
      const topicDetails = JSON.stringify(results);

      for (let topic of topics) {
        if (topicDetails.indexOf(topic.topic) > -1) {
          fn(null, true);
        } else {
          fn(error, false);
        }
      }
    });
  });

};

export function wrapCheckKafka(connectionString: string): any {
  return (fn) => isKafkaAvailable(connectionString, fn);
}
export { wrapCheckKafka as isKafkaAvailable };
