import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryMasterDataStore,
  MasterDataError,
  MasterDataService,
  StaticMasterDefinitionRegistry,
  type MasterDataEvent,
  type MasterDefinition,
} from "../src/worker/master-data";

const definitions: readonly MasterDefinition[] = [
  {
    key: "office_reference",
    schemaVersion: 1,
    supportsHierarchy: false,
    validateCode(code) {
      if (!/^[A-Z0-9_]+$/u.test(code)) throw new Error("invalid office code");
    },
    validateAttributes(attributes) {
      if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
        throw new Error("attributes must be an object");
      }
    },
  },
  {
    key: "category_tree",
    schemaVersion: 1,
    supportsHierarchy: true,
  },
];

const createFixture = (options?: {
  eventSink?: { emit(event: MasterDataEvent): Promise<void> | void };
  mutationGate?: { assertMutationAllowed(): Promise<void> | void };
}) => {
  const store = new InMemoryMasterDataStore();
  let counter = 0;
  let now = new Date("2026-10-04T00:00:00.000Z");
  const service = new MasterDataService({
    environment: "test",
    store,
    definitions: new StaticMasterDefinitionRegistry(definitions),
    eventSink: options?.eventSink,
    mutationGate: options?.mutationGate,
    now: () => now,
    generateId: () => `id-${++counter}`,
  });
  return {
    service,
    store,
    setNow(value: string) {
      now = new Date(value);
    },
  };
};

const createOffice = async (service: MasterDataService, code: string) => service.createItem({
  masterKey: "office_reference",
  code,
  actorId: "admin-1",
});

test("item identity stays stable while current/asOf resolves different revisions", async () => {
  const { service, setNow } = createFixture();
  const item = await createOffice(service, "TOKYO");
  const v1 = await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Tokyo Headquarters",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-04-01T00:00:00.000Z",
    displayOrder: 10,
    attributes: { region: "east" },
  });
  const v2 = await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: v1.item.version,
    label: "Tokyo Office",
    enabled: true,
    effectiveFrom: "2027-04-01T00:00:00.000Z",
    displayOrder: 10,
    attributes: { region: "east" },
  });

  const past = await service.resolveAsOf(item.id, "2026-10-01T00:00:00.000Z");
  assert.equal(past?.item.id, item.id);
  assert.equal(past?.revision.id, v1.revision.id);
  assert.equal(past?.revision.label, "Tokyo Headquarters");

  setNow("2027-05-01T00:00:00.000Z");
  const current = await service.resolveCurrent(item.id);
  assert.equal(current?.item.id, item.id);
  assert.equal(current?.revision.id, v2.revision.id);
  assert.equal(current?.revision.label, "Tokyo Office");

  const boundHistory = await service.resolveHistoricalRevision(v1.revision.id);
  assert.equal(boundHistory?.revision.label, "Tokyo Headquarters");
});

test("future revision does not replace current selection early", async () => {
  const { service } = createFixture();
  const item = await createOffice(service, "NAGOYA");
  const first = await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Nagoya",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
  });
  await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: first.item.version,
    label: "Nagoya Central",
    enabled: true,
    effectiveFrom: "2027-01-01T00:00:00.000Z",
  });

  const current = await service.resolveCurrent(item.id);
  assert.equal(current?.revision.label, "Nagoya");
});

test("overlapping revisions are rejected", async () => {
  const { service } = createFixture();
  const item = await createOffice(service, "OSAKA");
  const first = await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Osaka",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
  });

  await assert.rejects(
    () => service.addRevision({
      itemId: item.id,
      actorId: "admin-1",
      expectedItemVersion: first.item.version,
      label: "Overlapping Osaka",
      enabled: true,
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      effectiveTo: "2027-06-01T00:00:00.000Z",
    }),
    (error: unknown) => error instanceof MasterDataError && error.code === "overlapping_revision",
  );
});

test("disabled revision is excluded from selectable list but available for historical resolution", async () => {
  const { service } = createFixture();
  const item = await createOffice(service, "DISABLED");
  const created = await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Disabled Office",
    enabled: false,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });

  const selectable = await service.listSelectable("office_reference");
  assert.equal(selectable.length, 0);
  assert.equal(await service.resolveCurrent(item.id), null);
  assert.equal(
    (await service.resolveAsOf(item.id, "2026-10-04T00:00:00.000Z", { includeDisabled: true }))?.revision.id,
    created.revision.id,
  );
});

test("retired item is excluded from current selection but concrete historical revision remains readable", async () => {
  const { service, setNow } = createFixture();
  const item = await createOffice(service, "OLD");
  const created = await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Old Office",
    enabled: true,
    effectiveFrom: "2025-01-01T00:00:00.000Z",
  });
  setNow("2026-10-05T00:00:00.000Z");
  await service.retireItem({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: created.item.version,
  });

  assert.equal(await service.resolveCurrent(item.id), null);
  assert.equal(
    (await service.resolveHistoricalRevision(created.revision.id))?.revision.label,
    "Old Office",
  );
  assert.equal(
    (await service.resolveAsOf(item.id, "2026-10-01T00:00:00.000Z"))?.revision.label,
    "Old Office",
  );
});

test("stale item version fails closed", async () => {
  const { service } = createFixture();
  const item = await createOffice(service, "STALE");
  await service.addRevision({
    itemId: item.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Initial",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });

  await assert.rejects(
    () => service.retireItem({
      itemId: item.id,
      actorId: "admin-1",
      expectedItemVersion: 1,
    }),
    (error: unknown) => error instanceof MasterDataError && error.code === "conflict",
  );
});

test("hierarchy rejects self-parent and cycles", async () => {
  const { service } = createFixture();
  const parent = await service.createItem({ masterKey: "category_tree", code: "PARENT", actorId: "admin-1" });
  const child = await service.createItem({ masterKey: "category_tree", code: "CHILD", actorId: "admin-1" });
  const parentRevision = await service.addRevision({
    itemId: parent.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Parent",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  await service.addRevision({
    itemId: child.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Child",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    parentItemId: parent.id,
  });

  await assert.rejects(
    () => service.addRevision({
      itemId: parent.id,
      actorId: "admin-1",
      expectedItemVersion: parentRevision.item.version,
      label: "Parent Future",
      enabled: true,
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      parentItemId: child.id,
    }),
    (error: unknown) => error instanceof MasterDataError && error.code === "hierarchy_cycle",
  );
});

test("non-hierarchical master rejects parent references", async () => {
  const { service } = createFixture();
  const parent = await createOffice(service, "PARENT");
  const child = await createOffice(service, "CHILD");
  await service.addRevision({
    itemId: parent.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Parent",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  await assert.rejects(
    () => service.addRevision({
      itemId: child.id,
      actorId: "admin-1",
      expectedItemVersion: 1,
      label: "Child",
      enabled: true,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      parentItemId: parent.id,
    }),
    (error: unknown) => error instanceof MasterDataError && error.code === "invalid_parent",
  );
});

test("definition validates code and project attributes", async () => {
  const { service } = createFixture();
  await assert.rejects(
    () => service.createItem({ masterKey: "office_reference", code: "bad-code", actorId: "admin-1" }),
    /invalid office code/u,
  );

  const item = await createOffice(service, "VALID");
  await assert.rejects(
    () => service.addRevision({
      itemId: item.id,
      actorId: "admin-1",
      expectedItemVersion: 1,
      label: "Valid",
      enabled: true,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      attributes: ["not", "an", "object"],
    }),
    /attributes must be an object/u,
  );
});

test("mutation gate runs before master mutation", async () => {
  const { service } = createFixture({
    mutationGate: {
      assertMutationAllowed() {
        throw new Error("read-only");
      },
    },
  });
  await assert.rejects(
    () => service.createItem({ masterKey: "office_reference", code: "TOKYO", actorId: "admin-1" }),
    /read-only/u,
  );
});

test("event sink failure does not roll back committed master data", async () => {
  const { service } = createFixture({
    eventSink: {
      emit() {
        throw new Error("audit unavailable");
      },
    },
  });
  const item = await createOffice(service, "TOKYO");
  assert.equal(item.code, "TOKYO");
});

test("reference-like office values are data, not hard-coded core semantics", async () => {
  const { service } = createFixture();
  const nagoya = await createOffice(service, "NAGOYA");
  const tokyo = await createOffice(service, "TOKYO");
  await service.addRevision({
    itemId: nagoya.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Nagoya",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    displayOrder: 10,
  });
  await service.addRevision({
    itemId: tokyo.id,
    actorId: "admin-1",
    expectedItemVersion: 1,
    label: "Tokyo",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    displayOrder: 20,
  });

  const choices = await service.listSelectable("office_reference");
  assert.deepEqual(choices.map((value) => value.item.code), ["NAGOYA", "TOKYO"]);
});
