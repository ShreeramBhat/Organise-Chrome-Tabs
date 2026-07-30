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
  ],
});

globalThis.chrome = mock.chrome;
await import("../background.js");

function rows(groupTitle, currentGroupId = -1) {
  return [1, 2].map((tabId) => ({
    tabId,
    windowId: 10,
    title: `Tab ${tabId}`,
    url: `https://example.com/${tabId}`,
    pinned: false,
    movable: true,
    protected: false,
    close: false,
    currentGroupId,
    destinationKey: "existing:10",
    groupTitle,
    groupColor: "blue",
  }));
}

function plan(planRows, options = {}) {
  return {
    options,
    destinations: [
      {
        key: "existing:10",
        label: "Window 1",
        kind: "existing",
        windowId: 10,
      },
    ],
    rows: planRows,
  };
}

test("apply removes existing groups in the same undoable operation", async () => {
  await mock.dispatch({
    type: "APPLY_PLAN",
    plan: plan(rows("Research")),
  });
  const grouped = await mock.dispatch({ type: "GET_INVENTORY" });
  const groupedTabs = grouped.windows.flatMap((window) => window.tabs);
  assert.ok(groupedTabs.every((tab) => tab.groupId !== -1));
  const groupId = groupedTabs[0].groupId;

  const result = await mock.dispatch({
    type: "APPLY_PLAN",
    plan: plan(rows("", groupId), { removeExistingGroups: true }),
  });
  const ungroupedTabs = result.inventory.windows.flatMap(
    (window) => window.tabs,
  );
  assert.ok(ungroupedTabs.every((tab) => tab.groupId === -1));
  assert.deepEqual(result.execution.ungroupedTabIds.sort(), [1, 2]);

  const restored = await mock.dispatch({ type: "UNDO_LAST" });
  const restoredTabs = restored.inventory.windows.flatMap(
    (window) => window.tabs,
  );
  assert.ok(restoredTabs.every((tab) => tab.groupId !== -1));
});

test("remove-all-groups keeps tabs in their window and saves undo", async () => {
  const result = await mock.dispatch({ type: "UNGROUP_ALL" });
  const tabs = result.inventory.windows.flatMap((window) => window.tabs);
  assert.equal(result.inventory.windows.length, 1);
  assert.ok(tabs.every((tab) => tab.groupId === -1));
  assert.match(result.message, /without moving them/);

  const undoState = await mock.dispatch({ type: "GET_UNDO_STATE" });
  assert.equal(undoState.available, true);
});
