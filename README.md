# Distributed Wagering Processor — Solution

Backend challenge implementation using **Bun 1.x, TypeScript (strict), NestJS, MikroORM 7, PostgreSQL and MiniStack (SQS-compatible)**.

> This README documents the candidate's solution. The original challenge specification is preserved in `CHALLENGE.md`.

## Prerequisites

- Bun 1.x
- Docker Desktop with Docker Compose
- Git

The application runs on the host with Bun. PostgreSQL and MiniStack run under Docker Compose.

## Start locally

From the repository root:

```powershell
docker compose up -d
```

From the `api` directory:

```powershell
cd api
bun install
Copy-Item .env.example .env
bun src/messaging/setup-sqs.ts
bun run mikro-orm migration:up --config ./src/mikro-orm.config.ts
bun run build
bun run start:dev
```

The API listens on `http://127.0.0.1:3000` by default. The startup expects the PostgreSQL and MiniStack services to be reachable. Ensure the SQS queues are created before starting the application.

**Local development configuration:** `api/src/mikro-orm.config.ts` loads the `.env` file using `dotenv/config`. Copy `api/.env.example` to `api/.env` before running migrations. The example values match the development-only PostgreSQL container in `compose.yaml`. The `.env` file is Git-ignored; never commit production credentials. The SQS client uses local defaults in `api/src/messaging/sqs.ts`.

## Health checks

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/live
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

Readiness checks PostgreSQL and the wager request SQS queue.

## Create a wallet

```powershell
$body = @{
  playerId = [guid]::NewGuid().ToString()
  initialBalance = @{ amount = '100.00'; currency = 'BRL' }
} | ConvertTo-Json -Depth 5

$wallet = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/wallets' -Method POST -ContentType 'application/json' -Body $body
$wallet | ConvertTo-Json -Depth 5
```

A non-zero opening balance creates an internal `OPENING` transaction and corresponding ledger credit in the same SQL transaction.

## Submit a BET

Use the `playerId` returned or retained from the wallet creation example.

```powershell
$externalId = [guid]::NewGuid().ToString()
$bet = @{
  providerId = 'provider-a'
  externalTransactionId = $externalId
  playerId = $wallet.playerId
  walletId = $wallet.id
  roundId = 'round-demo'
  gameId = 'demo-game'
  kind = 'BET'
  money = @{ amount = '25.00'; currency = 'BRL' }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri 'http://127.0.0.1:3000/wagering/transactions' -Method POST -Headers @{ 'Idempotency-Key' = "provider-a:$externalId" } -ContentType 'application/json' -Body $bet
```

Re-send the same request with the same header to exercise persisted idempotency.

## Additional endpoints

- `GET /wallets/:walletId`
- `GET /wallets/:walletId/ledger?limit=50&cursor=...`
- `POST /wallets/:walletId/reconciliation`
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`

## Tests

While the NestJS application is running on port 3000:

```powershell
bunx vitest run src/domain/money.spec.ts
bun test test/wagering.integration.test.ts
```

The distributed test requires **three** running application processes using the same PostgreSQL and MiniStack infrastructure. Stop the single dev instance first, build, then run each command in its own terminal:

```powershell
# Terminal 1
$env:PORT='3000'; bun ./dist/main.js
# Terminal 2
$env:PORT='3001'; bun ./dist/main.js
# Terminal 3
$env:PORT='3002'; bun ./dist/main.js
```

In another terminal:

```powershell
bun test test/distributed-concurrency.test.ts
```

For the manual SQS smoke test:

```powershell
bun test/send-sqs-wager.ts
```

Tests use actual local PostgreSQL and MiniStack services. They are not a complete fault-injection suite; see `ARCHITECTURE.md` for tested guarantees and remaining limitations.

## Financial integrity

Money is represented by a decimal string in API contracts and by a `bigint`-backed Money value object in application calculations. PostgreSQL uses `NUMERIC(20,2)` and enforces ledger direction, balance consistency, FK relationships and an immutability trigger.

## Important limitations

This is a challenge implementation, **not production-ready software**. Authentication was omitted as an intentional scope decision; only BRL is accepted. The current version has incomplete structured metrics/logging and fault-injection coverage. The included PostgreSQL credentials are **development-only example values** in `compose.yaml` and `.env.example`, not production secrets. For design decisions and caveats, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Operational metrics

The application exposes operational metrics at:

GET /health/metrics

The endpoint reports transaction counts by status, Outbox
publication state and lag, pending-reference retry attempts,
average processing latency and approximate DLQ message count.

These metrics are derived from PostgreSQL and SQS state rather
than in-memory counters.

The endpoint is intended for local evaluation and should be
protected before exposing the service in production.