import assert from "node:assert/strict";
import test from "node:test";

import {
  createNavigationController,
  type BrowserHistoryPort,
  type HistoryLocationEntry,
  type NavigationCodec,
  type NavigationHistoryState,
} from "../src/frontend/routing";

type View = "home" | "list" | "detail";

const codec: NavigationCodec<View> = {
  encode(view) {
    return view === "home" ? "/" : `/${view}`;
  },
  decode(href) {
    const path = new URL(href, "https://example.test").pathname;
    if (path === "/") return "home";
    if (path === "/list") return "list";
    if (path === "/detail") return "detail";
    return null;
  },
};

class FakeHistory implements BrowserHistoryPort {
  private entries: HistoryLocationEntry[];
  private cursor: number;
  private listeners = new Set<(entry: HistoryLocationEntry) => void>();
  readonly operations: Array<{ readonly kind: "push" | "replace" | "go"; readonly href?: string; readonly delta?: number }> = [];

  constructor(initialHref = "/", initialState: unknown = null) {
    this.entries = [{ href: initialHref, state: initialState }];
    this.cursor = 0;
  }

  current() {
    return this.entries[this.cursor];
  }

  push(state: NavigationHistoryState, href: string) {
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push({ href, state });
    this.cursor += 1;
    this.operations.push({ kind: "push", href });
  }

  replace(state: NavigationHistoryState, href: string) {
    this.entries[this.cursor] = { href, state };
    this.operations.push({ kind: "replace", href });
  }

  go(delta: number) {
    this.operations.push({ kind: "go", delta });
    const next = this.cursor + delta;
    if (next < 0 || next >= this.entries.length) return;
    this.cursor = next;
    const entry = this.current();
    for (const listener of this.listeners) listener(entry);
  }

  subscribe(listener: (entry: HistoryLocationEntry) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("bootstrap preserves a valid deep link and replaces rather than pushing a duplicate entry", () => {
  const history = new FakeHistory("https://example.test/detail?ignored=true");
  const controller = createNavigationController({ codec, history, fallbackView: "home" });

  const result = controller.bootstrap();

  assert.equal(result.view, "detail");
  assert.equal(result.href, "/detail");
  assert.equal(result.index, 0);
  assert.deepEqual(history.operations, [{ kind: "replace", href: "/detail" }]);
});

test("unknown direct access canonicalizes to the fallback without adding browser history", () => {
  const history = new FakeHistory("/not-a-route");
  const controller = createNavigationController({ codec, history, fallbackView: "home" });

  controller.bootstrap();

  assert.equal(controller.getSnapshot().view, "home");
  assert.deepEqual(history.operations, [{ kind: "replace", href: "/" }]);
});

test("user navigation pushes each major view and browser back restores the intermediate view", async () => {
  const history = new FakeHistory("/");
  const controller = createNavigationController({ codec, history, fallbackView: "home" });
  controller.bootstrap();

  assert.equal(await controller.navigate("list"), true);
  assert.equal(await controller.navigate("detail"), true);
  assert.equal(controller.getSnapshot().view, "detail");

  controller.back();
  await flush();
  assert.equal(controller.getSnapshot().view, "list");
  assert.equal(controller.getSnapshot().index, 1);

  controller.back();
  await flush();
  assert.equal(controller.getSnapshot().view, "home");
  assert.equal(controller.getSnapshot().index, 0);

  assert.deepEqual(history.operations.map((item) => item.kind), ["replace", "push", "push", "go", "go"]);
});

test("replace changes the current view without adding a browser history entry", async () => {
  const history = new FakeHistory("/");
  const controller = createNavigationController({ codec, history, fallbackView: "home" });
  controller.bootstrap();
  await controller.navigate("list");

  controller.replace("detail");
  controller.back();
  await flush();

  assert.equal(controller.getSnapshot().view, "home");
  assert.deepEqual(history.operations.map((item) => item.kind), ["replace", "push", "replace", "go"]);
});

test("unsaved-state guard can block user-originated navigation before history changes", async () => {
  const history = new FakeHistory("/");
  let dirty = true;
  const controller = createNavigationController({
    codec,
    history,
    fallbackView: "home",
    canLeave: () => !dirty,
  });
  controller.bootstrap();

  assert.equal(await controller.navigate("list"), false);
  assert.equal(controller.getSnapshot().view, "home");
  assert.equal(history.operations.filter((item) => item.kind === "push").length, 0);

  dirty = false;
  assert.equal(await controller.navigate("list"), true);
  assert.equal(controller.getSnapshot().view, "list");
});

test("recognized browser back is restored when unsaved-state guard denies leaving", async () => {
  const history = new FakeHistory("/");
  let dirty = false;
  const controller = createNavigationController({
    codec,
    history,
    fallbackView: "home",
    canLeave: () => !dirty,
  });
  controller.bootstrap();
  await controller.navigate("list");
  await controller.navigate("detail");

  dirty = true;
  controller.back();
  await flush();
  await flush();

  assert.equal(controller.getSnapshot().view, "detail");
  assert.equal(controller.getSnapshot().index, 2);
  assert.deepEqual(history.operations.slice(-2), [
    { kind: "go", delta: -1 },
    { kind: "go", delta: 1 },
  ]);
});

test("history state contains only the navigation marker and index, not the application view", async () => {
  const history = new FakeHistory("/");
  const controller = createNavigationController({ codec, history, fallbackView: "home" });
  controller.bootstrap();
  await controller.navigate("detail");

  assert.deepEqual(history.current().state, {
    __fullstackNavigation: 1,
    index: 1,
  });
  assert.equal(JSON.stringify(history.current().state).includes("detail"), false);
});
