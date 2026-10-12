import assert from "node:assert/strict";
import test from "node:test";
import { listWorkhubApps, searchWorkhubApps, selectWorkhubHomeShortcuts, type WorkhubAppEntry } from "../src/reference/workhub/app-catalog";
import { listWorkhubRequestIntents } from "../src/reference/workhub/request-intents";

const keys = (role: string) => listWorkhubApps(role).map(app => app.key);

test("WORKHUB app catalog filters by the current server-side membership role", () => {
  assert.ok(keys("employee").includes("travel-request"));
  assert.ok(keys("employee").includes("expense-settlement"));
  assert.ok(!keys("employee").includes("admin-portal"));
  assert.ok(!keys("employee").includes("approval-tasks"));
  assert.ok(keys("manager").includes("approval-tasks"));
  assert.ok(!keys("manager").includes("travel-request"));
  assert.ok(keys("accounting").includes("expense-settlement"));
  assert.ok(!keys("accounting").includes("admin-portal"));
  assert.ok(keys("system_admin").includes("admin-portal"));
});

test("unknown role and absent membership cannot expose reference app names", () => {
  assert.deepEqual(listWorkhubApps(""), []);
  assert.deepEqual(listWorkhubApps("superuser"), []);
});

test("all connected reference apps use bounded internal launch paths", () => {
  for (const role of ["newcomer", "employee", "manager", "accounting", "corporate", "system_admin"]) {
    const apps = listWorkhubApps(role);
    assert.ok(apps.some(app => app.key === "announcements"));
    assert.equal(apps.find(app => app.key === "directory")?.availability, "available");
    for (const app of apps) {
      if (app.availability === "unavailable") assert.equal(app.launchTarget, null);
      else assert.match(app.launchTarget ?? "", /^\/(?:#workhub-[a-z-]+|admin)$/u);
      assert.ok(!("allowedRoles" in app), "authorization policy must not be in the public API projection");
    }
  }
});

test("global Apps search reuses the current authorized catalog and routes only connected apps", () => {
  const aoi = searchWorkhubApps("employee", "出張");
  assert.deepEqual(aoi.map(result => result.resourceId), ["travel-request", "expense-settlement"]);
  assert.deepEqual(aoi[0], {
    resourceType: "workhub_app",
    resourceId: "travel-request",
    category: "apps",
    title: "出張申請",
    snippet: "出張を申請する",
    actionTarget: "/#workhub-requests",
  });
  assert.deepEqual(searchWorkhubApps("employee", "管理ポータル"), []);
  assert.deepEqual(searchWorkhubApps("system_admin", "管理ポータル").map(result => result.actionTarget), ["/admin"]);
  assert.deepEqual(searchWorkhubApps("manager", "承認").map(result => result.resourceId), ["approval-tasks"]);
});

test("global Apps search reveals neither unauthorized nor unconnected app launch targets", () => {
  for (const role of ["", "unexpected", "employee", "manager", "accounting", "system_admin"]) {
    assert.deepEqual(searchWorkhubApps(role, "社員・組織").map(x => x.actionTarget), role === "unexpected" || !role ? [] : ["/#workhub-people"]);
    assert.deepEqual(searchWorkhubApps(role, "　"), [], "empty terms must not enumerate applications");
    for (const result of searchWorkhubApps(role, "社内")) {
      assert.match(result.actionTarget, /^\/(?:#workhub-[a-z-]+|admin)$/u);
    }
  }
  assert.deepEqual(searchWorkhubApps("unexpected", "管理ポータル"), []);
  assert.deepEqual(searchWorkhubApps("employee", "セキュリティ"), []);
});

test("HOME shortcuts are the first four connected apps from the already authorized catalog", () => {
  const employee = selectWorkhubHomeShortcuts(listWorkhubApps("employee"));
  assert.deepEqual(employee.map(app => app.key), ["travel-request", "expense-settlement", "announcements", "directory"]);
  assert.ok(employee.every(app => app.availability === "available" && app.launchTarget.startsWith("/")));
  assert.deepEqual(selectWorkhubHomeShortcuts(listWorkhubApps("manager")).map(app => app.key), [
    "approval-tasks", "announcements", "directory", "knowledge",
  ]);
  assert.deepEqual(selectWorkhubHomeShortcuts(listWorkhubApps("system_admin")).map(app => app.key), [
    "announcements", "directory", "knowledge", "admin-portal",
  ]);
  assert.deepEqual(selectWorkhubHomeShortcuts(listWorkhubApps("unknown")), []);
});

test("HOME shortcuts exclude unavailable and invalid targets and remain capped at four", () => {
  const base = listWorkhubApps("employee").find(app => app.key === "travel-request");
  assert.ok(base);
  const invalid: WorkhubAppEntry[] = [
    { ...base, key: "not-connected", availability: "unavailable", launchTarget: null },
    { ...base, key: "external", launchTarget: "https://invalid.example/" },
    { ...base, key: "script", launchTarget: "javascript:alert(1)" },
  ];
  const authorized = listWorkhubApps("employee");
  const result = selectWorkhubHomeShortcuts([...invalid, ...authorized, ...authorized]);
  assert.equal(result.length, 4);
  assert.ok(result.every(app => app.key !== "not-connected" && app.key !== "external" && app.key !== "script"));
  assert.deepEqual(result.slice(0, 3).map(app => app.key), ["travel-request", "expense-settlement", "announcements"]);
});

test("Stage 2 intent catalog launches only connected apps in the already-authorized role catalog", () => {
  const employee = listWorkhubRequestIntents(listWorkhubApps("employee"));
  assert.deepEqual(employee.filter(x => x.target).map(x => x.key), ["travel", "expenses"]);
  assert.deepEqual(employee.find(x => x.key === "travel")?.target, "/#workhub-requests");
  assert.deepEqual(listWorkhubRequestIntents(listWorkhubApps("manager"))
    .filter(x => x.target).map(x => x.key), ["approvals"]);
  assert.deepEqual(listWorkhubRequestIntents(listWorkhubApps("accounting"))
    .filter(x => x.target).map(x => x.key), ["expenses"]);
  assert.deepEqual(listWorkhubRequestIntents(listWorkhubApps("system_admin"))
    .filter(x => x.target).map(x => x.key), []);
});

test("planned moving and PC replacement journeys cannot accidentally submit business actions", () => {
  const intents = listWorkhubRequestIntents(listWorkhubApps("employee"));
  for (const key of ["moving", "pc-replacement"]) {
    const intent = intents.find(item => item.key === key);
    assert.equal(intent?.availability, "guide_only");
    assert.equal(intent?.target, null);
    assert.ok((intent?.steps.length ?? 0) > 1);
  }
  assert.deepEqual(listWorkhubRequestIntents([]).filter(x => x.target), []);
  const spoofed: WorkhubAppEntry = {
    ...listWorkhubApps("employee")[0], launchTarget: "https://evil.invalid/",
  };
  assert.deepEqual(listWorkhubRequestIntents([spoofed]).filter(x => x.target), []);
});

test("secondary mock journey links require an explicit server-provided capability", () => {
  const employee = listWorkhubRequestIntents(listWorkhubApps("employee"), true);
  const mock = employee.filter(x => x.key === "moving" || x.key === "pc-replacement");
  assert.equal(mock.length, 2);
  assert.ok(mock.every(x => x.availability === "connected"
    && x.target === "/#workhub-secondary-journeys"
    && x.description.includes("実際の")));
  assert.deepEqual(listWorkhubRequestIntents(listWorkhubApps("employee"))
    .filter(x => x.key === "moving" || x.key === "pc-replacement")
    .map(x => x.target), [null, null]);
});
