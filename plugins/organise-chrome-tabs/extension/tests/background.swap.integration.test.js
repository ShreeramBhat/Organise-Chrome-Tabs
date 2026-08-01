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
          title: "Apple Metal",
          url: "https://developer.apple.com/metal/",
        },
      ],
    },
    {
      id: 20,
      focused: false,
      tabs: [
        {
          id: 2,
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

test("cross-swapping the last tabs does not lose either destination window", async () => {
  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: [
        { tabId: 1, destination: { windowId: 20 } },
        { tabId: 2, destination: { windowId: 10 } },
      ],
    },
  });

  const result = await mock.dispatch({ type: "APPLY_PLAN", plan: preview.plan });
  assert.equal(result.inventory.windows.length, 2);
  assert.equal(
    result.inventory.windows
      .flatMap((window) => window.tabs)
      .find((tab) => tab.id === 1).windowId,
    20,
  );
  assert.equal(
    result.inventory.windows
      .flatMap((window) => window.tabs)
      .find((tab) => tab.id === 2).windowId,
    10,
  );
  assert.equal(
    result.inventory.windows
      .flatMap((window) => window.tabs)
      .some((tab) => tab.url === "chrome://newtab/"),
    false,
  );
});
