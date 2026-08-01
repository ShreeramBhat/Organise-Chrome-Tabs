import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentPlan } from "../lib/agent-plan.js";

function makeInventory() {
  return {
    windows: [
      {
        id: 10,
        focused: true,
        label: "Current",
        tabs: [
          {
            id: 1,
            windowId: 10,
            index: 0,
            active: true,
            pinned: false,
            groupId: 7,
            title: "Research paper",
            url: "https://arxiv.org/abs/1234",
          },
          {
            id: 2,
            windowId: 10,
            index: 1,
            active: false,
            pinned: true,
            groupId: -1,
            title: "Pinned",
            url: "https://example.com/pinned",
          },
        ],
      },
      {
        id: 20,
        focused: false,
        label: "Other",
        tabs: [
          {
            id: 3,
            windowId: 20,
            index: 0,
            active: true,
            pinned: false,
            groupId: -1,
            title: "Tab Steward",
            url: "chrome-extension://test/dashboard.html",
          },
          {
            id: 4,
            windowId: 20,
            index: 1,
            active: false,
            pinned: false,
            groupId: -1,
            title: "Survey paper",
            url: "https://arxiv.org/abs/5678",
          },
        ],
      },
    ],
  };
}

test("agent proposal changes only assigned tabs and coalesces new windows", () => {
  const plan = buildAgentPlan(makeInventory(), {
    version: 1,
    assignments: [
      {
        tabId: 1,
        destination: { newWindow: "Research" },
      },
      {
        tabId: 4,
        destination: { newWindow: "Research" },
      },
    ],
  });

  assert.equal(plan.source, "agent");
  assert.equal(plan.options.removeExistingGroups, true);
  assert.equal(plan.summary.moveCount, 2);
  assert.equal(plan.summary.newWindowCount, 1);
  assert.equal(plan.newWindows.length, 1);
  assert.equal(
    plan.rows.find((row) => row.tabId === 2).destinationKey,
    "existing:10",
  );
});

test("agent proposal supports an existing window and optional native group", () => {
  const plan = buildAgentPlan(makeInventory(), {
    version: 1,
    removeExistingGroups: false,
    assignments: [
      {
        tabId: 1,
        destination: { windowId: 20 },
        groupTitle: "Papers",
        groupColor: "blue",
      },
    ],
  });

  const row = plan.rows.find((candidate) => candidate.tabId === 1);
  assert.equal(row.destinationKey, "existing:20");
  assert.equal(row.groupTitle, "Papers");
  assert.equal(row.groupColor, "blue");
  assert.equal(plan.options.removeExistingGroups, false);
  assert.equal(plan.summary.groupCount, 1);
});

test("agent proposal rejects unsafe or stale assignments", () => {
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        assignments: [
          {
            tabId: 2,
            destination: { windowId: 20 },
          },
        ],
      }),
    /Pinned tab 2 cannot move/,
  );
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        assignments: [{ tabId: 999, destination: { windowId: 20 } }],
      }),
    /not in the current inventory/,
  );
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        assignments: [
          { tabId: 3, close: true },
        ],
      }),
    /cannot close its own dashboard/,
  );
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        assignments: [
          { tabId: 3, destination: { newWindow: "Elsewhere" } },
        ],
      }),
    /cannot move its own dashboard/,
  );
});

test("agent proposal rejects duplicate assignments and invalid destinations", () => {
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        assignments: [{ tabId: 1 }, { tabId: 1 }],
      }),
    /assigned more than once/,
  );
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        assignments: [
          {
            tabId: 1,
            destination: { windowId: 20, newWindow: "Research" },
          },
        ],
      }),
    /either windowId or newWindow/,
  );
});

test("agent proposal requires the versioned contract and boolean options", () => {
  assert.throws(
    () => buildAgentPlan(makeInventory(), { assignments: [] }),
    /version must be 1/,
  );
  assert.throws(
    () =>
      buildAgentPlan(makeInventory(), {
        version: 1,
        removeExistingGroups: "yes",
        assignments: [],
      }),
    /must be true or false/,
  );
});
