import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryTransactionalNotificationStore,
  TransactionalNotificationError,
  TransactionalNotificationService,
  type NotificationPolicy,
  type NotificationRecipientResolver,
} from "../src/worker/transactional-notification";

const policy: NotificationPolicy = {
  resolve(event) {
    if (event.eventType === "ignore") return { notify: false };
    return {
      notify: true,
      category: "workflow",
      notificationType: event.eventType,
      recipientResolverKey: event.eventType === "workflow.submit" ? "assignee" : "requester",
      titleKey: `notification.${event.eventType}.title`,
      messageKey: `notification.${event.eventType}.body`,
      actionTarget: event.resourceId ? `resource:${event.resourceType}:${event.resourceId}` : null,
    };
  },
};

const recipients: NotificationRecipientResolver = {
  async resolve(key, context) {
    const value = key === "assignee" ? context.event.attributes?.assigneePrincipal : context.event.attributes?.requesterId;
    return typeof value === "string" ? [value] : [];
  },
};

const fixture = () => {
  const store = new InMemoryTransactionalNotificationStore();
  let id = 0;
  const service = new TransactionalNotificationService({
    environment: "test",
    store,
    policy,
    recipients,
    now: () => new Date("2026-10-04T08:00:00.000Z"),
    generateId: () => `notification-${++id}`,
  });
  return { store, service };
};

const source = (eventType: string, sourceId = "transition-1") => ({
  sourceType: "workflow_transition",
  sourceId,
  eventType,
  resourceType: "travel_request",
  resourceId: "travel-1",
  occurredAt: "2026-10-04T08:00:00.000Z",
  attributes: { requesterId: "aoi", assigneePrincipal: "ren" },
});

test("workflow business event creates recipient-specific notification", async () => {
  const { service } = fixture();
  const created = await service.project(source("workflow.submit"));
  assert.equal(created.length, 1);
  assert.equal(created[0]?.recipientPrincipal, "ren");
  assert.equal(await service.countUnread("ren"), 1);
});

test("duplicate source event is suppressed by deterministic dedupe key", async () => {
  const { service } = fixture();
  assert.equal((await service.project(source("workflow.approved"))).length, 1);
  assert.equal((await service.project(source("workflow.approved"))).length, 0);
  assert.equal(await service.countUnread("aoi"), 1);
});

test("read and archive are recipient scoped and optimistic", async () => {
  const { store, service } = fixture();
  const [record] = await service.project(source("workflow.returned"));
  assert.ok(record);
  await service.markRead("aoi", record.id, 1);
  assert.equal(await service.countUnread("aoi"), 0);
  const updated = await store.get(record.id, "test");
  assert.equal(updated?.version, 2);
  await service.archive("aoi", record.id, 2);
  assert.equal((await service.list("aoi")).length, 0);
  await assert.rejects(() => service.archive("ren", record.id, 2), (error: unknown) => error instanceof TransactionalNotificationError && error.code === "conflict");
});

test("recipient resolution fails closed", async () => {
  const { service } = fixture();
  await assert.rejects(
    () => service.project({ ...source("workflow.approved"), attributes: {} }),
    (error: unknown) => error instanceof TransactionalNotificationError && error.code === "recipient_unresolved",
  );
});

test("a second business event source reuses the same foundation", async () => {
  const { service } = fixture();
  const created = await service.project({
    sourceType: "job_event",
    sourceId: "job-1-completed",
    eventType: "job.completed",
    resourceType: "import_job",
    resourceId: "job-1",
    occurredAt: "2026-10-04T08:00:00.000Z",
    attributes: { requesterId: "aoi" },
  });
  assert.equal(created[0]?.recipientPrincipal, "aoi");
});
