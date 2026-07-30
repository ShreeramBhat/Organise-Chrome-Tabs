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
      ],
    },
  ],
});

globalThis.chrome = mock.chrome;
await import("../background.js");

test("service worker rejects a stale preview before saving an undo snapshot", async () => {
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

  await mock.chrome.tabs.remove(2);

  await assert.rejects(
    mock.dispatch({
      type: "APPLY_PLAN",
      plan: preview.plan,
    }),
    /plan is stale/,
  );

  const inventory = await mock.dispatch({ type: "GET_INVENTORY" });
  assert.equal(inventory.windows.length, 1);
  assert.equal(inventory.windows[0].tabs[0].windowId, 10);
  assert.equal(
    (await mock.dispatch({ type: "GET_UNDO_STATE" })).available,
    false,
  );
});
