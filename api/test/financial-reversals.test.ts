
import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:3000';

type Wallet = {
  id: string;
  playerId: string;
  balance: {
    amount: string;
    currency: string;
  };
};

type TransactionResult = {
  transactionId: string;
  status: string;
  failureCode?: string;
  idempotentReplay: boolean;
};

type WagerKind = 'BET' | 'WIN' | 'REFUND' | 'ROLLBACK';

async function createWallet(): Promise<Wallet> {
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
    throw new Error(await response.text());
  }

  return response.json() as Promise<Wallet>;
}

function wager(
  wallet: Wallet,
  kind: WagerKind,
  amount: string,
  externalId: string,
  referenceExternalTransactionId?: string,
) {
  return {
    providerId: 'financial-reversals-test',
    externalTransactionId: externalId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'reversals-round',
    gameId: 'reversals-game',
    kind,
    money: {
      amount,
      currency: 'BRL',
    },
    ...(referenceExternalTransactionId
      ? { referenceExternalTransactionId }
      : {}),
  };
}

async function submit(
  body: object,
  externalId: string,
) {
  const response = await fetch(
    `${API}/wagering/transactions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `financial-test:${externalId}`,
      },
      body: JSON.stringify(body),
    },
  );

  return {
    http: response.status,
    data: (await response.json()) as TransactionResult,
  };
}

async function getBalance(walletId: string) {
  const response = await fetch(
    `${API}/wallets/${walletId}`,
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const wallet = (await response.json()) as Wallet;
  return wallet.balance.amount;
}

async function assertReconciliation(walletId: string) {
  const response = await fetch(
    `${API}/wallets/${walletId}/reconciliation`,
    { method: 'POST' },
  );

  expect(response.ok).toBe(true);

  const result = (await response.json()) as {
    consistent: boolean;
    difference: {
      amount: string;
      currency: string;
    };
  };

  expect(result.consistent).toBe(true);
  expect(result.difference.amount).toBe('0.00');
  expect(result.difference.currency).toBe('BRL');
}

test('REFUND reverses BET once', async () => {
  const wallet = await createWallet();

  const betId = randomUUID();
  const betResult = await submit(
    wager(wallet, 'BET', '40.00', betId),
    betId,
  );

  expect(betResult.http).toBe(200);
  expect(await getBalance(wallet.id)).toBe('60.00');

  const refundId = randomUUID();
  const refundPayload = wager(
    wallet, 'REFUND', '40.00', refundId, betId,
  );

  const refundResult = await submit(
    refundPayload,
    refundId,
  );

  expect(refundResult.http).toBe(200);
  expect(refundResult.data.status).toBe('PROCESSED');
  expect(await getBalance(wallet.id)).toBe('100.00');

  const replay = await submit(refundPayload, refundId);

  expect(replay.http).toBe(200);
  expect(replay.data.idempotentReplay).toBe(true);
  expect(await getBalance(wallet.id)).toBe('100.00');

  const duplicateId = randomUUID();
  const duplicate = await submit(
    wager(wallet, 'REFUND', '40.00', duplicateId, betId),
    duplicateId,
  );

  expect(duplicate.http).toBe(422);
  expect(await getBalance(wallet.id)).toBe('100.00');

  await assertReconciliation(wallet.id);

  console.log('REFUND: OK');
}, 30000);

test('ROLLBACK reverses WIN', async () => {
  const wallet = await createWallet();

  const winId = randomUUID();
  const win = await submit(
    wager(wallet, 'WIN', '25.00', winId),
    winId,
  );

  expect(win.http).toBe(200);
  expect(await getBalance(wallet.id)).toBe('125.00');

  const rollbackId = randomUUID();
  const rollback = await submit(
    wager(
      wallet,
      'ROLLBACK',
      '25.00',
      rollbackId,
      winId,
    ),
    rollbackId,
  );

  expect(rollback.http).toBe(200);
  expect(rollback.data.status).toBe('PROCESSED');
  expect(await getBalance(wallet.id)).toBe('100.00');

  await assertReconciliation(wallet.id);

  console.log('ROLLBACK WIN: OK');
}, 30000);

test('ROLLBACK rejects insufficient balance', async () => {
  const wallet = await createWallet();

  const winId = randomUUID();
  const win = await submit(
    wager(wallet, 'WIN', '25.00', winId),
    winId,
  );

  expect(win.http).toBe(200);

  const betId = randomUUID();
  const bet = await submit(
    wager(wallet, 'BET', '120.00', betId),
    betId,
  );

  expect(bet.http).toBe(200);
  expect(await getBalance(wallet.id)).toBe('5.00');

  const rollbackId = randomUUID();
  const rollback = await submit(
    wager(
      wallet,
      'ROLLBACK',
      '25.00',
      rollbackId,
      winId,
    ),
    rollbackId,
  );

  expect(rollback.http).toBe(422);
  expect(rollback.data.status).toBe('REJECTED');
  expect(rollback.data.failureCode).toBeTruthy();

  expect(await getBalance(wallet.id)).toBe('5.00');

  await assertReconciliation(wallet.id);

  console.log('ROLLBACK insufficient balance: OK');
}, 30000);


test('REFUND resolves when BET arrives later', async () => {
  const wallet = await createWallet();

  const betId = randomUUID();
  const refundId = randomUUID();

  const pending = await submit(
    wager(
      wallet,
      'REFUND',
      '40.00',
      refundId,
      betId,
    ),
    refundId,
  );

  expect(pending.http).toBe(202);
  expect(pending.data.status).toBe('PENDING_REFERENCE');
  expect(await getBalance(wallet.id)).toBe('100.00');

  // The referenced BET arrives afterwards.
  const betResult = await submit(
    wager(wallet, 'BET', '40.00', betId),
    betId,
  );

  expect(betResult.http).toBe(200);
  expect(betResult.data.status).toBe('PROCESSED');

  let finalStatus = '';

  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(
      `${API}/wagering/transactions/${pending.data.transactionId}`,
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const transaction = (await response.json()) as {
      status: string;
      failureCode?: string;
    };

    finalStatus = transaction.status;

    if (finalStatus === 'PROCESSED') {
      break;
    }

    if (finalStatus === 'REJECTED') {
      throw new Error(
        `Pending REFUND rejected: ${transaction.failureCode}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  expect(finalStatus).toBe('PROCESSED');

  expect(await getBalance(wallet.id)).toBe('100.00');

  await assertReconciliation(wallet.id);

  console.log('Out-of-order REFUND recovery: OK');
}, 45000);
