import test from "node:test";
import assert from "node:assert/strict";

import { createChromeMock } from "./chrome-mock.js";

const mock = createChromeMock({
  windows: [
    {
      id: 10,
      focused: true,
      tabs: [
        {
          id: 1,
          index: 0,
          active: true,
          title: "Research paper",
          url: "https://arxiv.org/abs/1",
        },
        {
          id: 2,
          index: 1,
          title: "Reference notes",
          url: "https://example.com/notes",
        },
      ],
    },
    {
      id: 20,
      focused: false,
      tabs: [
        {
          id: 3,
          index: 0,
          active: true,
          title: "Claude",
          url: "https://claude.ai/",
        },
      ],
    },
  ],
});

globalThis.chrome = mock.chrome;
await import("../background.js");

function planRow(tab, overrides = {}) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    pinned: false,
    movable: true,
    protected: false,
    close: false,
    currentGroupId: -1,
    destinationKey: `existing:${tab.windowId}`,
    groupTitle: "",
    groupColor: "grey",
    ...overrides,
  };
}

test("service worker applies a cross-window plan and restores it", async () => {
  const before = await mock.dispatch({ type: "GET_INVENTORY" });
  assert.equal(before.windows.length, 2);
  assert.equal(before.windows.flatMap((window) => window.tabs).length, 3);

  const tabs = before.windows.flatMap((window) => window.tabs);
  const plan = {
    destinations: [
      {
        key: "existing:20",
        label: "AI",
        kind: "existing",
        windowId: 20,
      },
      {
        key: "new:Research",
        label: "Research",
        kind: "new",
      },
    ],
    rows: [
      planRow(tabs.find((tab) => tab.id === 1), {
        destinationKey: "new:Research",
        groupTitle: "Papers",
        groupColor: "blue",
      }),
      planRow(tabs.find((tab) => tab.id === 2), {
        destinationKey: "new:Research",
        groupTitle: "Papers",
        groupColor: "blue",
      }),
      planRow(tabs.find((tab) => tab.id === 3)),
    ],
  };

  const applied = await mock.dispatch({ type: "APPLY_PLAN", plan });
  const appliedTabs = applied.inventory.windows.flatMap((window) => window.tabs);
  const movedOne = appliedTabs.find((tab) => tab.id === 1);
  const movedTwo = appliedTabs.find((tab) => tab.id === 2);

  assert.notEqual(movedOne.windowId, 10);
  assert.equal(movedOne.windowId, movedTwo.windowId);
  assert.notEqual(movedOne.groupId, -1);
  assert.equal(movedOne.groupId, movedTwo.groupId);
  assert.equal(
    movedOne.group.title,
    "Papers",
  );
  assert.equal(applied.inventory.windows.length, 2);

  const undoState = await mock.dispatch({ type: "GET_UNDO_STATE" });
  assert.equal(undoState.available, true);

  const undone = await mock.dispatch({ type: "UNDO_LAST" });
  const restoredTabs = undone.inventory.windows.flatMap((window) => window.tabs);
  const restoredOne = restoredTabs.find((tab) => tab.id === 1);
  const restoredTwo = restoredTabs.find((tab) => tab.id === 2);
  const restoredThree = restoredTabs.find((tab) => tab.id === 3);

  assert.equal(restoredOne.windowId, restoredTwo.windowId);
  assert.notEqual(restoredOne.windowId, restoredThree.windowId);
  assert.equal(restoredOne.groupId, -1);
  assert.equal(restoredTwo.groupId, -1);
  assert.equal(undone.inventory.windows.length, 2);

  const finalUndoState = await mock.dispatch({ type: "GET_UNDO_STATE" });
  assert.equal(finalUndoState.available, false);
});

test("service worker previews an agent plan without mutating Chrome", async () => {
  const before = await mock.dispatch({ type: "GET_INVENTORY" });
  const tab = before.windows
    .flatMap((window) => window.tabs)
    .find((candidate) => candidate.id === 1);

  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        {
          tabId: tab.id,
          destination: { newWindow: "Research" },
        },
      ],
    },
  });

  assert.equal(preview.summary.moveCount, 1);
  assert.equal(preview.summary.newWindowCount, 1);
  assert.equal(preview.plan.source, "agent");

  const afterPreview = await mock.dispatch({ type: "GET_INVENTORY" });
  assert.deepEqual(afterPreview.windows, before.windows);
  assert.equal(
    (await mock.dispatch({ type: "GET_UNDO_STATE" })).available,
    false,
  );

  const applied = await mock.dispatch({
    type: "APPLY_PLAN",
    plan: preview.plan,
  });
  const moved = applied.inventory.windows
    .flatMap((window) => window.tabs)
    .find((candidate) => candidate.id === tab.id);
  assert.notEqual(moved.windowId, tab.windowId);

  await mock.dispatch({ type: "UNDO_LAST" });
});

test("service worker snapshots a manually closed window and can recover it", async () => {
  const current = await mock.dispatch({ type: "GET_INVENTORY" });
  const windowWithClaude = current.windows.find((window) =>
    window.tabs.some((tab) => tab.url === "https://claude.ai/"),
  );
  assert.ok(windowWithClaude);

  const afterClose = await mock.dispatch({
    type: "CLOSE_WINDOW",
    windowId: windowWithClaude.id,
  });
  assert.equal(afterClose.windows.length, 1);

  const afterUndo = await mock.dispatch({ type: "UNDO_LAST" });
  assert.equal(afterUndo.inventory.windows.length, 2);
  assert.ok(
    afterUndo.inventory.windows
      .flatMap((window) => window.tabs)
      .some((tab) => tab.url === "https://claude.ai/"),
  );
});
