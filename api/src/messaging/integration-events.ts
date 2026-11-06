
import { randomUUID } from 'node:crypto';

type EventData = Readonly<Record<string, unknown>>;

export abstract class IntegrationEvent {
  abstract readonly eventType: string;
  readonly version = 1;
  readonly eventId = randomUUID();
  readonly occurredAt = new Date();

  protected constructor(
    readonly aggregateId: string,
    readonly correlationId: string,
    readonly data: EventData,
  ) {}

  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
  }
}


export class WagerTransactionProcessedEvent
  extends IntegrationEvent {
  readonly eventType = 'WagerTransactionProcessed';

  constructor(
    aggregateId: string,
    correlationId: string,
    data: EventData,
  ) {
    super(aggregateId, correlationId, data);
  }
}

export class WagerTransactionRejectedEvent
  extends IntegrationEvent {
  readonly eventType = 'WagerTransactionRejected';

  constructor(
    aggregateId: string,
    correlationId: string,
    data: EventData,
  ) {
    super(aggregateId, correlationId, data);
  }
}

export class WalletBalanceChangedEvent
  extends IntegrationEvent {
  readonly eventType = 'WalletBalanceChanged';

  constructor(
    aggregateId: string,
    correlationId: string,
    data: EventData,
  ) {
    super(aggregateId, correlationId, data);
  }
}

export class WagerTransactionPendingReferenceEvent
  extends IntegrationEvent {
  readonly eventType = 'WagerTransactionPendingReference';

  constructor(
    aggregateId: string,
    correlationId: string,
    data: EventData,
  ) {
    super(aggregateId, correlationId, data);
  }
}
