import test from "node:test";
import assert from "node:assert/strict";

import { buildPlan, canonicalizeUrl } from "../lib/planner.js";

function tab(id, windowId, title, url, overrides = {}) {
  return {
    id,
    windowId,
    index: id,
    active: false,
    pinned: false,
    groupId: -1,
    title,
    url,
    ...overrides,
  };
}

const inventory = {
  windows: [
    {
      id: 10,
      focused: true,
      label: "Development",
      tabs: [
        tab(1, 10, "Pull requests · openai/codex", "https://github.com/openai/codex/pulls"),
        tab(2, 10, "JavaScript Guide", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide"),
        tab(3, 10, "TypeScript package", "https://www.npmjs.com/package/typescript"),
        tab(4, 10, "Important pinned tab", "https://example.com/pinned", {
          pinned: true,
        }),
      ],
    },
    {
      id: 20,
      focused: false,
      label: "",
      tabs: [
        tab(5, 20, "ChatGPT", "https://chatgpt.com/"),
        tab(6, 20, "Claude", "https://claude.ai/"),
        tab(7, 20, "Gemini", "https://gemini.google.com/"),
      ],
    },
    {
      id: 30,
      focused: false,
      label: "",
      tabs: [
        tab(8, 30, "OpenAI Codex", "https://openai.com/codex"),
        tab(9, 30, "Codex pull requests duplicate", "https://github.com/openai/codex/pulls#open"),
      ],
    },
  ],
};

test("canonicalizeUrl removes tracking and fragments but preserves content parameters", () => {
  assert.equal(
    canonicalizeUrl(
      "https://youtube.com/watch?v=abc&utm_source=test#comments",
    ),
    "https://youtube.com/watch?v=abc",
  );
});

test("planner reuses a strongly matching existing window", () => {
  const plan = buildPlan(inventory, {
    strategy: "topic-windows",
    minWindowSize: 3,
    minGroupSize: 2,
  });

  const developmentRows = plan.rows.filter(
    (row) => row.workspace === "Software Development",
  );
  assert.ok(developmentRows.length >= 3);
  assert.ok(
    developmentRows.every((row) => row.destinationKey === "existing:10"),
  );
});

test("planner creates a topic window when reuse is disabled", () => {
  const plan = buildPlan(inventory, {
    strategy: "topic-windows",
    minWindowSize: 3,
    reuseExistingWindows: false,
  });

  const aiRows = plan.rows.filter(
    (row) => row.workspace === "AI & Automation",
  );
  assert.equal(aiRows.length, 4);
  assert.ok(
    aiRows.every(
      (row) => row.destinationKey === "new:AI & Automation",
    ),
  );
  assert.ok(
    plan.newWindows.some(
      (window) => window.key === "new:AI & Automation",
    ),
  );
});

test("pinned tabs never move automatically", () => {
  const plan = buildPlan(inventory, {
    strategy: "topic-windows",
    minWindowSize: 2,
    reuseExistingWindows: false,
  });
  const pinned = plan.rows.find((row) => row.tabId === 4);

  assert.equal(pinned.movable, false);
  assert.equal(pinned.destinationKey, "existing:10");
});

test("duplicate closing is opt-in and keeps a preferred copy", () => {
  const plan = buildPlan(inventory, {
    closeDuplicates: true,
    strategy: "keep-windows",
  });
  const duplicates = plan.rows.filter((row) => row.duplicate);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].tabId, 9);
  assert.equal(duplicates[0].close, true);
  assert.equal(plan.summary.closeCount, 1);
});

test("keep-windows strategy never proposes a cross-window move", () => {
  const plan = buildPlan(inventory, { strategy: "keep-windows" });

  assert.ok(
    plan.rows.every(
      (row) => row.destinationKey === `existing:${row.windowId}`,
    ),
  );
  assert.equal(plan.summary.newWindowCount, 0);
  assert.equal(plan.summary.moveCount, 0);
});

test("native grouping is off by default and can be explicitly enabled", () => {
  const withoutGroups = buildPlan(inventory, {
    strategy: "keep-windows",
    minGroupSize: 2,
  });
  const withGroups = buildPlan(inventory, {
    strategy: "keep-windows",
    minGroupSize: 2,
    createGroups: true,
  });

  assert.equal(withoutGroups.options.removeExistingGroups, true);
  assert.ok(withoutGroups.rows.every((row) => row.groupTitle === ""));
  assert.ok(withGroups.rows.some((row) => row.groupTitle !== ""));
});
