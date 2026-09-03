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
          title: "Notes",
          url: "https://example.com/notes",
        },
        {
          id: 3,
          index: 2,
          title: "Unrelated reading",
          url: "https://example.com/reading",
        },
        {
          id: 4,
          index: 3,
          title: "Stable article",
          url: "https://example.com/stable",
        },
        {
          id: 5,
          index: 4,
          title: "Window-sensitive article",
          url: "https://example.com/window-sensitive",
        },
      ],
    },
    {
      id: 20,
      focused: false,
      tabs: [
        {
          id: 6,
          index: 0,
          active: true,
          title: "Destination anchor",
          url: "https://example.com/destination",
        },
      ],
    },
  ],
});

globalThis.chrome = mock.chrome;
await import("../background.js");

test("unrelated tab churn after preview does not invalidate the plan", async () => {
  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        {
          tabId: 1,
          destination: { newWindow: "Research" },
        },
      ],
    },
  });

  await mock.chrome.tabs.remove(3);

  const applied = await mock.dispatch({
    type: "APPLY_PREVIEWED_PLAN",
    applyToken: preview.applyToken,
  });
  const moved = applied.inventory.windows
    .flatMap((window) => window.tabs)
    .find((tab) => tab.id === 1);
  assert.notEqual(moved.windowId, 10);
  assert.equal(applied.inventory.windows.length, 3);
});

test("apply rejects a stale preview when a planned tab vanishes", async () => {
  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        {
          tabId: 2,
          destination: { newWindow: "More Research" },
        },
      ],
    },
  });

  await mock.chrome.tabs.remove(2);

  await assert.rejects(
    mock.dispatch({
      type: "APPLY_PREVIEWED_PLAN",
      applyToken: preview.applyToken,
    }),
    /plan is stale/,
  );

  // A stale failure clears the pending plan, so retrying the same apply must
  // demand a fresh preview instead of running against the changed browser.
  await assert.rejects(
    mock.dispatch({
      type: "APPLY_PREVIEWED_PLAN",
      applyToken: preview.applyToken,
    }),
    /previewed/,
  );
});

test("apply rejects a stale preview when a planned tab navigates", async () => {
  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        { tabId: 4, destination: { newWindow: "Stable Research" } },
      ],
    },
  });

  await mock.chrome.tabs.update(4, { url: "https://example.com/changed" });

  await assert.rejects(
    mock.dispatch({
      type: "APPLY_PREVIEWED_PLAN",
      applyToken: preview.applyToken,
    }),
    /plan is stale/,
  );
});

test("apply rejects a stale preview when a planned tab changes windows", async () => {
  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        { tabId: 5, destination: { newWindow: "Window Research" } },
      ],
    },
  });

  await mock.chrome.tabs.move(5, { windowId: 20, index: -1 });

  await assert.rejects(
    mock.dispatch({
      type: "APPLY_PREVIEWED_PLAN",
      applyToken: preview.applyToken,
    }),
    /plan is stale/,
  );
});
