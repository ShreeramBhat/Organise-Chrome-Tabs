import test from "node:test";
import assert from "node:assert/strict";

import { createChromeMock } from "./chrome-mock.js";

const windows = Array.from({ length: 4 }, (_, windowIndex) => ({
  id: (windowIndex + 1) * 10,
  focused: windowIndex === 0,
  tabs: Array.from({ length: 40 }, (_, tabIndex) => {
    const id = windowIndex * 40 + tabIndex + 1;
    return {
      id,
      index: tabIndex,
      active: tabIndex === 0,
      title: `Reference tab ${id}`,
      url: `https://example.com/reference/${id}`,
    };
  }),
}));

const mock = createChromeMock({ windows });

globalThis.chrome = mock.chrome;
await import("../background.js");

test("large previews return a compact token and apply the stored canonical plan", async () => {
  const preview = await mock.dispatch({
    type: "PREVIEW_AGENT_PLAN",
    proposal: {
      version: 1,
      assignments: Array.from({ length: 40 }, (_, index) => ({
        tabId: index + 1,
        destination: { newWindow: "Collected Research" },
      })),
    },
  });

  assert.ok(preview.applyToken);
  assert.equal(preview.summary.tabCount, 160);
  assert.equal(preview.summary.moveCount, 40);
  assert.equal("plan" in preview, false);
  assert.ok(JSON.stringify(preview).length < 512);

  const applied = await mock.dispatch({
    type: "APPLY_PREVIEWED_PLAN",
    applyToken: preview.applyToken,
  });
  const movedWindowIds = new Set(
    applied.inventory.windows
      .flatMap((window) => window.tabs)
      .filter((tab) => tab.id <= 40)
      .map((tab) => tab.windowId),
  );

  assert.equal(movedWindowIds.size, 1);
  assert.notEqual([...movedWindowIds][0], 10);
});
