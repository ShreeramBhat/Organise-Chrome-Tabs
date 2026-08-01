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

test("apply removes existing groups in the same undoable operation", async () => {
  const groupPreview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      removeExistingGroups: false,
      assignments: [
        { tabId: 1, groupTitle: "Research", groupColor: "blue" },
        { tabId: 2, groupTitle: "Research", groupColor: "blue" },
      ],
    },
  });
  await mock.dispatch({ type: "APPLY_PLAN", plan: groupPreview.plan });
  const grouped = await mock.dispatch({ type: "GET_INVENTORY" });
  const groupedTabs = grouped.windows.flatMap((window) => window.tabs);
  assert.ok(groupedTabs.every((tab) => tab.groupId !== -1));

  const ungroupPreview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      removeExistingGroups: true,
      assignments: [],
    },
  });
  const result = await mock.dispatch({
    type: "APPLY_PLAN",
    plan: ungroupPreview.plan,
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
