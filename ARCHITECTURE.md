# Architecture — Distributed Wagering Processor

## 1. Scope and current state

This project implements a NestJS/TypeScript backend that accepts wagering operations through HTTP and an AWS SQS-compatible FIFO queue. It stores wallets, wager transactions, and immutable ledger records in PostgreSQL; it uses a transactional outbox to publish integration events and a persistent inbox to deduplicate consumed messages.

The implemented flows have been exercised locally using PostgreSQL and MiniStack in Docker, including a two-way wallet balance/ledger reconciliation, an out-of-order REFUND, a repeat-delivery test, and concurrent requests across three separate application processes. **Passing these scenarios does not establish exhaustive crash-safety or production readiness.** The limitations below are part of the current state, not claims of completed work.

## 2. Technology decisions

- **Runtime/package manager:** Bun 1.x. TypeScript is configured in strict mode.
- **HTTP framework:** NestJS, with controllers and services.
- **Persistence:** PostgreSQL and MikroORM 7 (legacy decorators). Transactions are handled with `EntityManager.transactional()`; queries use row-level locks where appropriate.
- **Message transport:** AWS SDK for JavaScript (`@aws-sdk/client-sqs`) against MiniStack locally. Separate FIFO queues are used for wager requests and integration events, with a DLQ for wager requests.
- **Local orchestration:** Docker Compose starts PostgreSQL and MiniStack. At present the application itself is started locally with Bun, not as a Compose service.

### Why MikroORM?

MikroORM provides an explicit unit of work, entity manager, transactions, and pessimistic locking, making the transaction boundaries visible. PostgreSQL remains the system of record for consistency, unique constraints, and referential integrity. The ORM is not relied upon as the sole enforcer of financial invariants.

## 3. Money and data representation

The `Money` value object (`src/domain/money.ts`) receives monetary values as decimal strings, performs arithmetic using integer cents backed by `bigint`, and serializes results with exactly two decimal places. Cross-currency arithmetic is rejected. Monetary columns use PostgreSQL `NUMERIC(20,2)` rather than floating-point storage.

The current HTTP implementation accepts BRL only, while the data model preserves currency as an explicit attribute. This is an intentional scope reduction permitted by the challenge. There is still a limitation around safely mapping numeric overflow and some validation errors to stable domain failure codes.

## 4. Domain rules and current boundaries

- **Wallet:** one wallet per `(playerId, currency)` (database unique constraint); current balance and version are stored with the wallet. Version starts at 1 and increases on balance changes.
- **Opening:** a positive opening balance creates an internal `OPENING` transaction and `CREDIT` ledger entry within the same database transaction. Zero opening balance creates no movement.
- **BET:** debits if sufficient funds exist; otherwise records a rejected transaction without a ledger movement.
- **WIN:** credits the wallet.
- **LOSS:** records a processed transaction without changing balance or creating a ledger entry.
- **REFUND:** reverses a processed BET by crediting the wallet, subject to reference checks.
- **ROLLBACK:** reverses a processed BET, WIN or REFUND, subject to reference and sufficient-funds checks.
- **Missing reference:** persists `PENDING_REFERENCE`, then a scheduled worker retries with backoff and ultimately rejects after a bounded number of attempts.

The current code uses mutable MikroORM persistence entities and service-oriented business logic. It does **not** yet fully implement the reference DDD design of encapsulated aggregate roots with private constructors, explicit rehydration factories, and domain transition methods. This is an architectural gap relative to the challenge and should not be hidden.

## 5. Transactional consistency and ledger

PostgreSQL transactions group the wallet update, wager status, ledger entry, and outbox event(s) atomically in the normal processing path. Opening persistence uses `flush()` for wallet and opening records in FK-safe order, inside the same outer transaction; `flush()` is not a commit.

The ledger schema includes:

- `CHECK` constraints for positive movement amounts, nonnegative before/after balances, valid direction, and the relationship `balanceAfter = balanceBefore ± amount`;
- uniqueness of `(wallet_id, transaction_id)`;
- a composite foreign key linking each ledger entry to the matching wager transaction (`transaction_id`, `wallet_id`, `amount`, `currency`);
- a PostgreSQL trigger rejecting `UPDATE` or `DELETE` against ledger entries.

An actual update was attempted and PostgreSQL rejected it. A separate reconciliation query sums credits minus debits and compares the result with the stored wallet balance, without modifying a divergence automatically.

**Remaining limitations:** some schema-level invariants are not enforced end-to-end, including a database-only guarantee that every wallet balance change has exactly one corresponding ledger entry. Foreign-key and trigger constraints need to be rechecked after future ORM-generated migrations. Privileged database roles can alter triggers/schema and must be controlled in production.

## 6. Concurrency

`walletId` is the unit of concurrency. Financial operations acquire a PostgreSQL pessimistic row lock on the target wallet inside a database transaction. This serializes operations on a hot wallet across separate NestJS processes while allowing unrelated wallets to proceed independently. There is no global in-process mutex used as a correctness mechanism.

Verified local integration scenarios:

1. Two bets for 80.00 against a wallet containing 100.00: exactly one `PROCESSED`, one `REJECTED` for insufficient funds, final balance 20.00, and one debit ledger entry.
2. Fifty identical requests distributed across three independently running application processes: one transaction ID, one debit, final balance 75.00 from an initial 100.00, and wallet version 2.

These results do not replace stress testing, crash injection, or measuring lock contention under sustained load.

## 7. Idempotency

The HTTP API requires `Idempotency-Key`; the key and a SHA-256 hash of deterministically ordered business fields are persisted in `wager_transactions`. A repeated request with matching key/hash returns the persisted transaction outcome and original result balance, with `idempotentReplay: true`. Reuse of a key with a different payload returns a conflict. Unique constraints are the ultimate protection when parallel requests attempt the same insert.

For SQS input, the persistent inbox uses uniqueness on `(consumerName, messageId)` and stores a payload hash and processing timestamp. The consumer passes the same EntityManager to the wagering use case so that inbox state and financial work can participate in one transaction. The SQS delete/ack is performed only after a successful commit.

A repeated-message test preserved wallet balance 75.00 and version 2. This is evidence for that tested path; crash-after-commit-before-ack and cross-instance redelivery race tests remain necessary.

## 8. Messaging, Outbox, and retries

An integration event is written to `outbox_messages` in the same SQL transaction as its corresponding financial state. Supported event types currently include `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference`, and `WalletBalanceChanged` (only on actual balance changes).

A scheduled publisher selects pending rows with `FOR UPDATE SKIP LOCKED`, sends to `wager-events.fifo` and records `publishedAt` on success. On failures it schedules a retry with backoff. Publication is **at least once**: a crash after SQS accepts a message but before `publishedAt` commits may cause a repeated publication. Downstream consumers must handle duplicate event IDs.

Wager requests arrive in `wager-transactions.fifo`, with `wager-transactions-dlq.fifo` configured as the dead-letter queue. The consumer uses a persisted inbox, reuses the wagering use case, and acknowledges successful messages after the SQL commit.

**Known gaps:** current consumer error handling retries broad errors instead of clearly distinguishing terminal business errors from transient infrastructure errors; DLQ behavior and graceful shutdown under in-flight processing have not been validated under fault injection. The publisher currently holds a DB transaction during network I/O, which is simple but can increase lock duration. There is no comprehensive crash-recovery test harness.

## 9. HTTP endpoints

Implemented endpoints:

- `POST /wallets`
- `GET /wallets/:walletId`
- `GET /wallets/:walletId/ledger?cursor=...&limit=50`
- `POST /wallets/:walletId/reconciliation`
- `POST /wagering/transactions` (requires `Idempotency-Key`)
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/metrics`

Ledger pagination uses a Base64URL-encoded cursor built from `(createdAt, id)` and orders records by those two fields. The cursor is opaque to callers but not cryptographically protected. The reconciliation endpoint exposes stored, calculated, and difference balances and returns a consistency flag.

The readiness check verifies PostgreSQL and the wager-request SQS queue; liveness confirms the process can serve HTTP requests.

## 10. Observability

Current observability includes NestJS logs, JSON-formatted HTTP request logs, a liveness route, and a readiness route that checks PostgreSQL and SQS connectivity. Divergence during reconciliation is logged.

The `GET /health/metrics` endpoint reports transaction counts by status, Outbox pending/published counts, oldest pending event age, accumulated pending-reference retry attempts, average transaction processing latency, and approximate DLQ message count. These are point-in-time metrics derived from PostgreSQL and SQS state.

### Structured HTTP logging

A global NestJS interceptor emits JSON-formatted HTTP request logs containing timestamp, severity, correlation ID, method, path, HTTP status, and request duration.

Provider, wallet, and transaction identifiers are included when available. Idempotent replay information is also recorded. Full request bodies and financial amounts are deliberately excluded.

**Remaining limitations:** SQS consumers, Outbox publishers, and background workers still use NestJS's default logging rather than a unified structured logging system. Dedicated counters for duplicate detection and lock conflicts, comprehensive fault-injection diagnostics, and operational dashboards remain incomplete.

## 11. Testing evidence

Automated (14 passing tests in the latest local run):

- `src/domain/money.spec.ts`: 6 Money tests (Vitest).
- `test/wagering.integration.test.ts`: 2 HTTP/database integration tests (idempotency and contested wallet balance).
- `test/financial-reversals.test.ts`: 4 integration tests covering REFUND, ROLLBACK of a WIN, insufficient balance on ROLLBACK, and out-of-order REFUND recovery.
- `test/distributed-concurrency.test.ts`: 2 tests against three running application processes (contested funds and 50 identical parallel requests).

Manually verified:

- opening and wager ledger entries; stored balance equaling ledger reconstruction;
- BET, WIN, LOSS, REFUND, and ROLLBACK basic flows;
- SQS wager message processing with persisted inbox state;
- replayed SQS message producing no additional debit in the observed run;
- Outbox publication showing 333 published events and zero pending events in the latest observed metrics snapshot;
- PostgreSQL rejecting an attempt to update an existing immutable ledger entry;
- `GET /health/live`, `GET /health/ready`, and `GET /health/metrics` returning successful responses;
- an SQS message queued while all NestJS instances were stopped being processed after restart: wallet balance 75.00 BRL, version 2, and ledger reconciliation with zero difference.

These checks were run against local services rather than all being encoded as repeatable CI tests. Remaining test gaps include mismatched references, database failures mid-transaction, reference expiration, crash-after-commit-before-ack, concurrent publishers, DLQ redrive, independent wallets under sustained load, and repeatable automated restart-recovery fault injection.

## 12. Security, deployment, and limitations

- Database connection settings are environment-based in `api/src/mikro-orm.config.ts`, with local loading from `.env` through `dotenv/config`. The `.env.example` file and Docker Compose contain development-only defaults; deployments must provide independent secrets and should not use those local defaults.
- Authentication was omitted to focus on financial correctness. The challenge permits omission if documented; these HTTP routes must not be exposed publicly without authentication and authorization.
- The local Compose file currently runs the infrastructure dependencies; a single-command full application Compose startup is not yet available.
- Supporting only BRL is intentional; the model is currency-aware.
- Certain requirements are partial: complete DDD encapsulation, strict error taxonomy, production observability, complete resilience/fault-injection coverage, and some edge-case validation.

## 13. Follow-up priorities

1. Harden environment configuration for production: require nonempty secrets, validate configuration on boot, and use a proper secret manager outside local development.
2. Add repeatable error-injection and recovery tests, including kill-after-commit-before-ack and DLQ flow.
3. Expand automated business-rule, reconciliation, and migration tests.
4. Extend structured logging to SQS consumers and background workers,
   and add missing operational counters.
5. Containerize the application itself with an explicit dependency/readiness startup sequence.
