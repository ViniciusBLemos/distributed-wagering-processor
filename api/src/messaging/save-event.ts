
import { EntityManager } from '@mikro-orm/postgresql';

import { IntegrationEvent } from './integration-events.js';
import { OutboxMessageEntity } from './outbox-message.entity.js';

export function saveEvent(
  em: EntityManager,
  event: IntegrationEvent,
): void {
  const message = new OutboxMessageEntity();

  message.id = event.eventId;
  message.aggregateId = event.aggregateId;
  message.eventType = event.eventType;
  message.payload = event.toJSON();
  message.occurredAt = event.occurredAt;

  em.persist(message);
}
