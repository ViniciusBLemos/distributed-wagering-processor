
import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

const API = [
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
];

type Wallet = {
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  version: number;
};

type Result = {
  transactionId?: string;
  status?: string;
  failureCode?: string;
  idempotentReplay?: boolean;
};

async function createWallet(): Promise<Wallet> {
  const playerId = randomUUID();

  const response = await fetch(`${API[0]}/wallets`, {
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
    throw new Error(await response.text());
  }

  return response.json() as Promise<Wallet>;
}

function makeBet(
  wallet: Wallet,
  externalTransactionId: string,
  amount: string,
) {
  return {
    providerId: 'distributed-test',
    externalTransactionId,
    walletId: wallet.id,
    playerId: wallet.playerId,
    roundId: 'distributed-round',
    gameId: 'test-game',
    kind: 'BET',
    money: {
      amount,
      currency: 'BRL',
    },
  };
}

async function submit(
  api: string,
  payload: object,
  key: string,
) {
  const response = await fetch(
    `${api}/wagering/transactions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    },
  );

  return {
    http: response.status,
    data: (await response.json()) as Result,
  };
}

async function getWallet(id: string): Promise<Wallet> {
  const response = await fetch(`${API[2]}/wallets/${id}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<Wallet>;
}

async function getLedger(id: string) {
  const response = await fetch(
    `${API[2]}/wallets/${id}/ledger?limit=100`,
  );

  if (!response.ok) throw new Error(await response.text());

  return response.json() as Promise<{
    entries: Array<{
      direction: string;
      money: { amount: string };
    }>;
  }>;
}

test('duas instancias disputam o mesmo saldo', async () => {
  const wallet = await createWallet();

  const idA = randomUUID();
  const idB = randomUUID();

  const [a, b] = await Promise.all([
    submit(API[0], makeBet(wallet, idA, '80.00'), idA),
    submit(API[1], makeBet(wallet, idB, '80.00'), idB),
  ]);

  expect([a.http, b.http].sort((x, y) => x - y))
    .toEqual([200, 422]);

  expect(
    [a.data, b.data].filter(
      (item) => item.status === 'PROCESSED',
    ),
  ).toHaveLength(1);

  expect(
    [a.data, b.data].filter(
      (item) =>
        item.status === 'REJECTED' &&
        item.failureCode === 'INSUFFICIENT_FUNDS',
    ),
  ).toHaveLength(1);

  const finalWallet = await getWallet(wallet.id);
  expect(finalWallet.balance.amount).toBe('20.00');
  expect(finalWallet.version).toBe(2);

  const ledger = await getLedger(wallet.id);
  expect(
    ledger.entries.filter(
      (entry) => entry.direction === 'DEBIT',
    ),
  ).toHaveLength(1);

  console.log('Concorrencia entre instancias: OK');
}, 30000);

test('50 requisicoes identicas em tres instancias', async () => {
  const wallet = await createWallet();

  const externalId = randomUUID();
  const payload = makeBet(wallet, externalId, '25.00');
  const key = `distributed-test:${externalId}`;

  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      submit(API[index % API.length], payload, key),
    ),
  );

  expect(results.map((r) => r.http))
    .toEqual(Array(50).fill(200));

  expect(
    results.every((r) => r.data.status === 'PROCESSED'),
  ).toBe(true);

  expect(
    new Set(results.map((r) => r.data.transactionId)).size,
  ).toBe(1);

  expect(
    results.filter((r) => !r.data.idempotentReplay),
  ).toHaveLength(1);

  const finalWallet = await getWallet(wallet.id);
  expect(finalWallet.balance.amount).toBe('75.00');
  expect(finalWallet.version).toBe(2);

  const ledger = await getLedger(wallet.id);
  expect(
    ledger.entries.filter(
      (entry) => entry.direction === 'DEBIT',
    ),
  ).toHaveLength(1);

  console.log('50 requisicoes duplicadas: OK');
}, 30000);
