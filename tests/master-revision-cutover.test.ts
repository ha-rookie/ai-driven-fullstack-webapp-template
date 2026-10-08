import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryMasterDataStore, MasterDataError, MasterDataService, StaticMasterDefinitionRegistry,
} from "../src/worker/master-data";

const createFixture = () => {
  const store = new InMemoryMasterDataStore();
  let sequence = 0;
  let clock = new Date("2026-10-09T00:00:00.000Z");
  const service = new MasterDataService({
    environment: "test",
    store,
    definitions: new StaticMasterDefinitionRegistry([{ key: "office", schemaVersion: 1 }]),
    now: () => clock,
    generateId: () => "revision-fixture-" + ++sequence,
  });
  return {
    service, store,
    advance: (value: string) => { clock = new Date(value); },
  };
};

const seeded = async (service: MasterDataService) => {
  const item = await service.createItem({ masterKey: "office", code: "TOKYO", actorId: "admin" });
  const first = await service.addRevision({
    itemId: item.id, actorId: "admin", expectedItemVersion: 1,
    label: "Tokyo Original", enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    displayOrder: 20, attributes: { region: "east" },
  });
  return { item, first };
};
const cutoff = "2027-04-01T00:00:00.000Z";

test("atomic cutover resolves old value before cutoff and new value from exact boundary", async () => {
  const { service, advance } = createFixture();
  const { item, first } = await seeded(service);
  const scheduled = await service.scheduleRevision({
    itemId: item.id, priorRevisionId: first.revision.id,
    actorId: "admin", expectedItemVersion: first.item.version,
    effectiveFrom: cutoff, label: "Tokyo Renamed", enabled: true,
  });
  assert.equal(scheduled.item.version, first.item.version + 1);
  assert.equal(scheduled.item.nextRevision, first.item.nextRevision + 1);
  assert.equal(scheduled.revision.revision, first.revision.revision + 1);
  assert.deepEqual(scheduled.revision.attributes, { region: "east" });
  assert.equal(scheduled.revision.displayOrder, 20);
  assert.equal((await service.resolveCurrent(item.id))?.revision.id, first.revision.id);
  assert.equal(
    (await service.resolveAsOf(item.id, "2027-03-31T23:59:59.999Z"))?.revision.label,
    "Tokyo Original",
  );
  assert.equal((await service.resolveAsOf(item.id, cutoff))?.revision.id, scheduled.revision.id);
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.effectiveTo, cutoff);
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.label, "Tokyo Original");
  advance("2027-04-01T00:00:00.000Z");
  assert.equal((await service.resolveCurrent(item.id))?.revision.label, "Tokyo Renamed");
});

test("stale concurrent cutover conflicts without changing original effective period", async () => {
  const { service } = createFixture();
  const { item, first } = await seeded(service);
  const command = {
    itemId: item.id, priorRevisionId: first.revision.id, actorId: "admin",
    expectedItemVersion: first.item.version, effectiveFrom: cutoff,
    label: "Scheduled", enabled: true,
  };
  await service.scheduleRevision(command);
  await assert.rejects(
    () => service.scheduleRevision({ ...command, label: "Competing" }),
    (e: unknown) => e instanceof MasterDataError && e.code === "conflict",
  );
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.effectiveTo, cutoff);
  assert.equal((await service.resolveAsOf(item.id, cutoff))?.revision.label, "Scheduled");
});

test("retroactive or immediate scheduled changes are rejected", async () => {
  const { service } = createFixture();
  const { item, first } = await seeded(service);
  for (const timestamp of ["2026-10-08T00:00:00.000Z", "2026-10-09T00:00:00.000Z"]) {
    await assert.rejects(
      () => service.scheduleRevision({
        itemId: item.id, priorRevisionId: first.revision.id,
        actorId: "admin", expectedItemVersion: first.item.version,
        effectiveFrom: timestamp, label: "Bad", enabled: true,
      }),
      (e: unknown) => e instanceof MasterDataError && e.code === "invalid_input",
    );
  }
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.effectiveTo, null);
});

test("scheduled revision cannot replace a wrong prior Revision or a closed period", async () => {
  const { service } = createFixture();
  const { item, first } = await seeded(service);
  await assert.rejects(
    () => service.scheduleRevision({
      itemId: item.id, priorRevisionId: "not-current",
      actorId: "admin", expectedItemVersion: first.item.version,
      effectiveFrom: cutoff, label: "Wrong", enabled: true,
    }),
    (e: unknown) => e instanceof MasterDataError && e.code === "conflict",
  );
  assert.equal((await service.resolveCurrent(item.id))?.revision.id, first.revision.id);
});

test("retired item cannot be scheduled even if a revision remains queryable", async () => {
  const { service } = createFixture();
  const { item, first } = await seeded(service);
  await service.retireItem({
    itemId: item.id, actorId: "admin", expectedItemVersion: first.item.version,
  });
  await assert.rejects(
    () => service.scheduleRevision({
      itemId: item.id, priorRevisionId: first.revision.id,
      actorId: "admin", expectedItemVersion: first.item.version + 1,
      effectiveFrom: cutoff, label: "Bad", enabled: true,
    }),
    (e: unknown) => e instanceof MasterDataError && e.code === "retired",
  );
});

test("future disable removes selection only after cutoff but preserves historical Revision ID", async () => {
  const { service, advance } = createFixture();
  const { item, first } = await seeded(service);
  const result = await service.scheduleRevision({
    itemId: item.id, priorRevisionId: first.revision.id,
    actorId: "admin", expectedItemVersion: first.item.version,
    effectiveFrom: cutoff, label: first.revision.label, enabled: false,
  });
  assert.equal(result.revision.enabled, false);
  assert.equal((await service.resolveCurrent(item.id))?.revision.id, first.revision.id);
  advance(cutoff);
  assert.equal(await service.resolveCurrent(item.id), null);
  assert.deepEqual(await service.listSelectable("office"), []);
  assert.equal(
    (await service.resolveAsOf(item.id, cutoff, { includeDisabled: true }))?.revision.id,
    result.revision.id,
  );
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.label, "Tokyo Original");
  assert.equal(
    (await service.resolveAsOf(item.id, "2027-03-31T23:59:59.999Z"))?.revision.id,
    first.revision.id,
  );
});

test("future enable makes previously disabled current Master selectable only at cutoff", async () => {
  const { service, advance } = createFixture();
  const item = await service.createItem({ masterKey: "office", code: "DISABLED", actorId: "admin" });
  const first = await service.addRevision({
    itemId: item.id, actorId: "admin", expectedItemVersion: 1,
    label: "Re-enable Candidate", enabled: false,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  const result = await service.scheduleRevision({
    itemId: item.id, priorRevisionId: first.revision.id,
    actorId: "admin", expectedItemVersion: first.item.version,
    effectiveFrom: cutoff, label: first.revision.label, enabled: true,
  });
  assert.equal(await service.resolveCurrent(item.id), null);
  advance(cutoff);
  assert.equal((await service.resolveCurrent(item.id))?.revision.id, result.revision.id);
  assert.equal((await service.listSelectable("office")).length, 1);
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.enabled, false);
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.effectiveTo, cutoff);
});

test("failed stale disable cannot create a second overlapping status change", async () => {
  const { service } = createFixture();
  const { item, first } = await seeded(service);
  const command = {
    itemId: item.id, priorRevisionId: first.revision.id, actorId: "admin",
    expectedItemVersion: first.item.version, effectiveFrom: cutoff,
    label: first.revision.label, enabled: false,
  };
  await service.scheduleRevision(command);
  await assert.rejects(() => service.scheduleRevision(command),
    (error: unknown) => error instanceof MasterDataError && error.code === "conflict");
  assert.equal((await service.resolveHistoricalRevision(first.revision.id))?.revision.effectiveTo, cutoff);
});
