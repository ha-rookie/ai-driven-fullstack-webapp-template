import assert from "node:assert/strict";
import test from "node:test";

import {
  MasterDataService,
  InMemoryMasterDataStore,
  StaticMasterDefinitionRegistry,
} from "../src/worker/master-data";
import {
  InMemoryWorkflowStore,
  StaticWorkflowDefinitionRegistry,
  WorkflowService,
} from "../src/worker/workflow";
import {
  InMemoryTravelRequestStore,
  TravelRequestError,
  TravelRequestService,
  WORKHUB_OFFICE_MASTER_DEFINITION,
  WORKHUB_OFFICE_MASTER_KEY,
  WORKHUB_REFERENCE_OFFICES,
  WORKHUB_TRAVEL_ASSIGNEE_RESOLVER,
  WORKHUB_TRAVEL_WORKFLOW_DEFINITION,
} from "../src/reference/workhub/travel-request";

const NOW = "2026-10-04T05:30:00.000Z";

const createFixture = () => {
  const masterStore = new InMemoryMasterDataStore();
  const workflowStore = new InMemoryWorkflowStore();
  const travelStore = new InMemoryTravelRequestStore();
  let masterCounter = 0;
  let workflowCounter = 0;
  let travelCounter = 0;

  const masterData = new MasterDataService({
    environment: "test",
    store: masterStore,
    definitions: new StaticMasterDefinitionRegistry([WORKHUB_OFFICE_MASTER_DEFINITION]),
    now: () => new Date(NOW),
    generateId: () => `master-${++masterCounter}`,
  });
  const workflow = new WorkflowService({
    environment: "test",
    store: workflowStore,
    definitions: new StaticWorkflowDefinitionRegistry([WORKHUB_TRAVEL_WORKFLOW_DEFINITION]),
    assignees: WORKHUB_TRAVEL_ASSIGNEE_RESOLVER,
    now: () => new Date(NOW),
    generateId: () => `workflow-${++workflowCounter}`,
  });
  const travel = new TravelRequestService({
    environment: "test",
    store: travelStore,
    masterData,
    workflow,
    now: () => new Date(NOW),
    generateId: () => `travel-${++travelCounter}`,
  });

  return { masterData, masterStore, workflow, workflowStore, travel, travelStore };
};

const seedOffice = async (
  masterData: MasterDataService,
  code: string,
  label: string,
  options?: { enabled?: boolean; effectiveTo?: string },
) => {
  const item = await masterData.createItem({
    masterKey: WORKHUB_OFFICE_MASTER_KEY,
    code,
    actorId: "fixture-admin",
  });
  const resolved = await masterData.addRevision({
    itemId: item.id,
    actorId: "fixture-admin",
    expectedItemVersion: item.version,
    label,
    enabled: options?.enabled ?? true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: options?.effectiveTo ?? "2027-01-01T00:00:00.000Z",
  });
  return resolved;
};

const seedReferenceOffices = async (masterData: MasterDataService) => {
  const entries = [];
  for (const office of WORKHUB_REFERENCE_OFFICES) {
    entries.push(await seedOffice(masterData, office.code, office.label));
  }
  return entries;
};

const draftCommand = (officeItemId: string) => ({
  principalId: "workhub-demo-aoi",
  destinationOfficeItemId: officeItemId,
  startDate: "2026-10-20",
  endDate: "2026-10-21",
  purpose: "Tokyo customer meeting",
});

test("reference office choices come from Master Data instead of TravelRequest constants", async () => {
  const { masterData, travel } = createFixture();
  await seedReferenceOffices(masterData);
  const choices = await travel.listDestinationOffices();
  assert.deepEqual(choices.map((choice) => choice.item.code), ["NAGOYA", "TOKYO"]);
});

test("Aoi submits a TravelRequest and Ren receives the workflow work item", async () => {
  const { masterData, workflowStore, travel } = createFixture();
  const offices = await seedReferenceOffices(masterData);
  const tokyo = offices.find((office) => office.item.code === "TOKYO");
  assert.ok(tokyo);

  const draft = await travel.createDraft(draftCommand(tokyo.item.id));
  assert.equal(draft.status, "draft");
  assert.equal(draft.destinationOfficeRevisionId, null);

  const submitted = await travel.submit({
    id: draft.id,
    principalId: "workhub-demo-aoi",
    expectedVersion: draft.version,
    requestId: "request-travel-submit",
  });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.destinationOfficeRevisionId, tokyo.revision.id);
  assert.ok(submitted.workflowInstanceId);
  assert.ok(submitted.submissionKey);
  assert.equal(submitted.submittedAt, NOW);

  const item = await workflowStore.getOpenWorkItem(submitted.workflowInstanceId!, "test");
  assert.equal(item?.assigneePrincipal, "workhub-demo-ren");
  assert.equal(item?.stepKey, "manager_approval");
});

test("submit binds the concrete Office revision so later labels do not rewrite history", async () => {
  const { masterData, travel } = createFixture();
  const tokyo = await seedOffice(masterData, "TOKYO", "Tokyo Office");
  const draft = await travel.createDraft(draftCommand(tokyo.item.id));
  const submitted = await travel.submit({
    id: draft.id,
    principalId: "workhub-demo-aoi",
    expectedVersion: draft.version,
  });

  await masterData.addRevision({
    itemId: tokyo.item.id,
    actorId: "fixture-admin",
    expectedItemVersion: tokyo.item.version,
    label: "Tokyo Headquarters",
    enabled: true,
    effectiveFrom: "2027-01-01T00:00:00.000Z",
  });

  const historical = await masterData.resolveHistoricalRevision(submitted.destinationOfficeRevisionId!);
  assert.equal(historical?.revision.label, "Tokyo Office");
});

test("stale Draft updates and another principal both fail closed", async () => {
  const { masterData, travel } = createFixture();
  const tokyo = await seedOffice(masterData, "TOKYO", "Tokyo Office");
  const draft = await travel.createDraft(draftCommand(tokyo.item.id));
  const updated = await travel.updateDraft({
    ...draftCommand(tokyo.item.id),
    id: draft.id,
    expectedVersion: draft.version,
    purpose: "Updated purpose",
  });
  assert.equal(updated.version, 2);

  await assert.rejects(
    () => travel.updateDraft({
      ...draftCommand(tokyo.item.id),
      id: draft.id,
      expectedVersion: draft.version,
    }),
    (error: unknown) => error instanceof TravelRequestError && error.code === "conflict",
  );
  await assert.rejects(
    () => travel.get(draft.id, "workhub-demo-ren"),
    (error: unknown) => error instanceof TravelRequestError && error.code === "forbidden",
  );
});

test("disabled, expired, and retired offices cannot be used for a new submit", async () => {
  const cases = [
    { code: "DISABLED", enabled: false, effectiveTo: "2027-01-01T00:00:00.000Z", retire: false },
    { code: "EXPIRED", enabled: true, effectiveTo: "2026-09-01T00:00:00.000Z", retire: false },
    { code: "RETIRED", enabled: true, effectiveTo: "2027-01-01T00:00:00.000Z", retire: true },
  ] as const;

  for (const candidate of cases) {
    const { masterData, travel } = createFixture();
    const office = await seedOffice(masterData, candidate.code, candidate.code, {
      enabled: candidate.enabled,
      effectiveTo: candidate.effectiveTo,
    });
    if (candidate.retire) {
      await masterData.retireItem({
        itemId: office.item.id,
        actorId: "fixture-admin",
        expectedItemVersion: office.item.version,
      });
    }
    const draft = await travel.createDraft(draftCommand(office.item.id));
    await assert.rejects(
      () => travel.submit({
        id: draft.id,
        principalId: "workhub-demo-aoi",
        expectedVersion: draft.version,
      }),
      (error: unknown) => error instanceof TravelRequestError && error.code === "office_unavailable",
    );
  }
});

test("duplicate submit does not create a second Workflow instance", async () => {
  const { masterData, workflowStore, travel } = createFixture();
  const tokyo = await seedOffice(masterData, "TOKYO", "Tokyo Office");
  const draft = await travel.createDraft(draftCommand(tokyo.item.id));
  const submitted = await travel.submit({
    id: draft.id,
    principalId: "workhub-demo-aoi",
    expectedVersion: draft.version,
  });

  await assert.rejects(
    () => travel.submit({
      id: draft.id,
      principalId: "workhub-demo-aoi",
      expectedVersion: submitted.version,
    }),
    (error: unknown) => error instanceof TravelRequestError && error.code === "invalid_state",
  );
  const open = await workflowStore.listOpenWorkItems("workhub-demo-ren", "test");
  assert.equal(open.length, 1);
});

test("definite Workflow start failure rolls the reservation back to Draft", async () => {
  const { masterData, travelStore } = createFixture();
  const tokyo = await seedOffice(masterData, "TOKYO", "Tokyo Office");
  let idCounter = 0;
  const travel = new TravelRequestService({
    environment: "test",
    store: travelStore,
    masterData,
    workflow: {
      async start() {
        throw new Error("workflow persistence unavailable");
      },
    },
    now: () => new Date(NOW),
    generateId: () => `failure-${++idCounter}`,
  });
  const draft = await travel.createDraft(draftCommand(tokyo.item.id));

  await assert.rejects(
    () => travel.submit({
      id: draft.id,
      principalId: "workhub-demo-aoi",
      expectedVersion: draft.version,
    }),
    (error: unknown) => error instanceof TravelRequestError && error.code === "workflow_failed",
  );

  const rolledBack = await travelStore.get(draft.id, "test");
  assert.equal(rolledBack?.status, "draft");
  assert.equal(rolledBack?.destinationOfficeRevisionId, null);
  assert.equal(rolledBack?.submissionKey, null);
  assert.equal(rolledBack?.workflowInstanceId, null);
  assert.equal(rolledBack?.version, 3);
});
