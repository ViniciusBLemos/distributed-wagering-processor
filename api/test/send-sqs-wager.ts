
import { randomUUID } from 'node:crypto';
import {
  GetQueueUrlCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

import {
  createSqsClient,
  QUEUES,
} from '../src/messaging/sqs.js';

const API = 'http://127.0.0.1:3000';

async function main() {
  const playerId = randomUUID();

  const response = await fetch(`${API}/wallets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      playerId,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const wallet = (await response.json()) as {
    id: string;
  };

  console.log('Carteira criada:', wallet.id);

  const messageId = randomUUID();
  const externalId = randomUUID();

  const envelope = {
    messageId,
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'provider-a',
      externalTransactionId: externalId,
      idempotencyKey: `provider-a:${externalId}`,
      playerId,
      walletId: wallet.id,
      roundId: 'round-sqs-test',
      gameId: 'sqs-test',
      kind: 'BET',
      money: {
        amount: '25.00',
        currency: 'BRL',
      },
    },
  };

  const sqs = createSqsClient();

  try {
    const queue = await sqs.send(
      new GetQueueUrlCommand({
        QueueName: QUEUES.transactions,
      }),
    );

    if (!queue.QueueUrl) {
      throw new Error('SQS queue not found');
    }

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queue.QueueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: messageId,
      }),
    );

    console.log('Mensagem enviada ao SQS:', messageId);

    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const result = await fetch(`${API}/wallets/${wallet.id}`);

      if (!result.ok) {
        throw new Error(await result.text());
      }

      const current = (await result.json()) as {
        balance: { amount: string };
        version: number;
      };

      if (current.balance.amount === '75.00') {
        console.log('Aposta processada com sucesso!');
        console.log('Saldo final:', current.balance.amount);

console.log('Versão:', current.version);

await sqs.send(
  new SendMessageCommand({
    QueueUrl: queue.QueueUrl,
    MessageBody: JSON.stringify(envelope),
    MessageGroupId: wallet.id,
    MessageDeduplicationId: randomUUID(),
  }),
);

console.log('Mensagem duplicada enviada');

await new Promise((resolve) => setTimeout(resolve, 5000));

const check = await fetch(`${API}/wallets/${wallet.id}`);

if (!check.ok) {
  throw new Error(await check.text());
}

const finalWallet = (await check.json()) as {
  balance: { amount: string };
  version: number;
};

if (
  finalWallet.balance.amount !== '75.00' ||
  finalWallet.version !== 2
) {
  throw new Error(
    'ERRO: a mensagem duplicada alterou a carteira!',
  );
}

console.log('Teste de duplicação concluído');
console.log('Saldo:', finalWallet.balance.amount);
console.log('Versão:', finalWallet.version);

return;

      }
    }

    throw new Error(
      'Aposta não foi processada dentro da janela de teste',
    );
  } finally {
    sqs.destroy();
  }
}

await main();
