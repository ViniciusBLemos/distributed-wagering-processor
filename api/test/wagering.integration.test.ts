
import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:3000';

type WagerResponse = {
  transactionId: string;
  status: string;
  failureCode?: string;
  balance: {
    amount: string;
    currency: string;
  };
  idempotentReplay: boolean;
};

async function createWallet() {
  const playerId = randomUUID();

  const response = await fetch(`${API}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Wallet creation failed: ${await response.text()}`,
    );
  }

  const wallet = (await response.json()) as { id: string };

  return {
    walletId: wallet.id,
    playerId,
  };
}

function bet(
  walletId: string,
  playerId: string,
  externalTransactionId: string,
) {
  return {
    providerId: 'provider-a',
    externalTransactionId,
    playerId,
    walletId,
    roundId: 'round-test',
    gameId: 'game-test',
    kind: 'BET',
    money: {
      amount: '80.00',
      currency: 'BRL',
    },
  };
}

async function submit(
  body: object,
  key: string,
) {
  const response = await fetch(
    `${API}/wagering/transactions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
    },
  );

  const data = (await response.json()) as WagerResponse;

  return { statusCode: response.status, data };
}

describe('Wagering integration', () => {
  test('same request does not debit twice', async () => {
    const { walletId, playerId } = await createWallet();

    const externalId = randomUUID();
    const payload = bet(walletId, playerId, externalId);
    const key = `provider-a:${externalId}`;

    const first = await submit(payload, key);
    const second = await submit(payload, key);

    expect(first.statusCode).toBe(200);
    expect(first.data.status).toBe('PROCESSED');
    expect(first.data.balance.amount).toBe('20.00');
    expect(first.data.idempotentReplay).toBe(false);

    expect(second.statusCode).toBe(200);
    expect(second.data.transactionId)
      .toBe(first.data.transactionId);
    expect(second.data.balance.amount).toBe('20.00');
    expect(second.data.idempotentReplay).toBe(true);

    const conflict = await submit(
      {
        ...payload,
        money: { amount: '70.00', currency: 'BRL' },
      },
      key,
    );

    expect(conflict.statusCode).toBe(409);

    console.log('Idempotency test passed');
  }, 15000);

  test('two concurrent bets cannot overspend', async () => {
    const { walletId, playerId } = await createWallet();

    const idA = randomUUID();
    const idB = randomUUID();

    const [a, b] = await Promise.all([
      submit(
        bet(walletId, playerId, idA),
        `provider-a:${idA}`,
      ),
      submit(
        bet(walletId, playerId, idB),
        `provider-a:${idB}`,
      ),
    ]);

    console.log('Concurrency responses:', {
      a: {
        status: a.statusCode,
        data: a.data,
      },
      b: {
        status: b.statusCode,
        data: b.data,
      },
    });

    const statuses = [a.statusCode, b.statusCode].sort();

    expect(statuses).toEqual([200, 422]);

    const processed = [a.data, b.data].filter(
      (result) => result.status === 'PROCESSED',
    );

    const rejected = [a.data, b.data].filter(
      (result) => result.status === 'REJECTED',
    );

    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].failureCode)
      .toBe('INSUFFICIENT_FUNDS');

    const response = await fetch(`${API}/wallets/${walletId}`);
    const wallet = (await response.json()) as {
      balance: { amount: string };
      version: number;
    };

    expect(wallet.balance.amount).toBe('20.00');
    expect(wallet.version).toBe(2);

    console.log('Concurrency test passed');
  }, 15000);
});
