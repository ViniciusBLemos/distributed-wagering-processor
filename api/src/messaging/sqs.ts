
import { SQSClient } from '@aws-sdk/client-sqs';

export const QUEUES = {
  transactions: 'wager-transactions.fifo',
  dlq: 'wager-transactions-dlq.fifo',
  events: 'wager-events.fifo',
} as const;

export function createSqsClient(): SQSClient {
  return new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint:
      process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey:
        process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
    maxAttempts: 2,
  });
}
