
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

import { createSqsClient, QUEUES } from './sqs.js';

const sqs = createSqsClient();

async function main() {
  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUES.dlq,
      Attributes: {
        FifoQueue: 'true',
      },
    }),
  );

  if (!dlq.QueueUrl) {
    throw new Error('Failed to create DLQ');
  }

  const attributes = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlq.QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );

  const dlqArn = attributes.Attributes?.QueueArn;

  if (!dlqArn) {
    throw new Error('DLQ ARN not found');
  }

  const transactions = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUES.transactions,
      Attributes: {
        FifoQueue: 'true',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: 5,
        }),
      },
    }),
  );

  const events = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUES.events,
      Attributes: {
        FifoQueue: 'true',
      },
    }),
  );

  console.log('DLQ:', dlq.QueueUrl);
  console.log('Transactions:', transactions.QueueUrl);
  console.log('Events:', events.QueueUrl);
}

try {
  await main();
} finally {
  sqs.destroy();
}
