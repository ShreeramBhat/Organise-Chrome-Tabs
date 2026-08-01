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

test("service worker applies a previewed cross-window plan and restores it", async () => {
  const before = await mock.dispatch({ type: "GET_INVENTORY" });
  assert.equal(before.windows.length, 2);
  assert.equal(before.windows.flatMap((window) => window.tabs).length, 3);
  assert.equal(before.version, "0.3.0");

  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        {
          tabId: 1,
          destination: { newWindow: "Research" },
          groupTitle: "Papers",
          groupColor: "blue",
        },
        {
          tabId: 2,
          destination: { newWindow: "Research" },
          groupTitle: "Papers",
          groupColor: "blue",
        },
      ],
    },
  });
  assert.ok(preview.plan.applyToken);

  const applied = await mock.dispatch({ type: "APPLY_PLAN", plan: preview.plan });
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

test("apply rejects plans that were not previewed or were tampered with", async () => {
  await assert.rejects(
    mock.dispatch({
      type: "APPLY_PLAN",
      plan: { destinations: [], rows: [] },
    }),
    /previewed/,
  );

  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [{ tabId: 2, destination: { newWindow: "Notes" } }],
    },
  });
  const tampered = structuredClone(preview.plan);
  tampered.rows.find((row) => row.tabId === 2).close = true;

  await assert.rejects(
    mock.dispatch({ type: "APPLY_PLAN", plan: tampered }),
    /does not match/,
  );
});

test("proposals cannot move or close the dashboard tab", async () => {
  const dashboardTab = await mock.chrome.tabs.create({
    windowId: 20,
    url: "chrome-extension://test-extension/dashboard.html",
  });
  await mock.chrome.tabs.update(dashboardTab.id, { title: "Tab Steward" });

  await assert.rejects(
    mock.dispatch({
      type: "PREVIEW_AGENT_PLAN",
      proposal: {
        version: 1,
        assignments: [
          { tabId: dashboardTab.id, destination: { newWindow: "Elsewhere" } },
        ],
      },
    }),
    /cannot move its own dashboard/,
  );

  await assert.rejects(
    mock.dispatch({
      type: "PREVIEW_AGENT_PLAN",
      proposal: {
        version: 1,
        assignments: [{ tabId: dashboardTab.id, close: true }],
      },
    }),
    /cannot close its own dashboard/,
  );

  await mock.chrome.tabs.remove(dashboardTab.id);
});

test("unknown message types receive an explicit error", async () => {
  await assert.rejects(
    mock.dispatch({ type: "BOGUS_MESSAGE" }),
    /Unknown message type "BOGUS_MESSAGE"/,
  );
});
