import { buildPlan } from "./planner.js";

const GROUP_COLORS = new Set([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

function requireInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  return value;
}

function cleanLabel(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function recomputeSummary(plan) {
  const movingRows = plan.rows.filter(
    (row) =>
      !row.close &&
      row.movable &&
      row.destinationKey !== `existing:${row.windowId}`,
  );
  const newWindowKeys = new Set(
    plan.rows
      .filter((row) => !row.close && row.destinationKey.startsWith("new:"))
      .map((row) => row.destinationKey),
  );
  const groupKeys = new Set(
    plan.rows
      .filter((row) => !row.close && row.groupTitle)
      .map((row) => `${row.destinationKey}\u0000${row.groupTitle}`),
  );

  plan.summary = {
    ...plan.summary,
    moveCount: movingRows.length,
    newWindowCount: newWindowKeys.size,
    groupCount: groupKeys.size,
    closeCount: plan.rows.filter((row) => row.close).length,
  };
}

/**
 * Convert a small, agent-authored proposal into Tab Steward's canonical plan.
 *
 * Proposal shape:
 * {
 *   version: 1,
 *   removeExistingGroups: true,
 *   assignments: [{
 *     tabId: 123,
 *     destination: { windowId: 42 } | { newWindow: "Research" },
 *     groupTitle?: "Papers",
 *     groupColor?: "blue",
 *     close?: false
 *   }]
 * }
 *
 * Tabs omitted from assignments remain in their current windows.
 */
export function buildAgentPlan(inventory, proposal = {}) {
  if (proposal.version !== 1) {
    throw new Error("Agent proposal version must be 1.");
  }
  if (
    proposal.assignments !== undefined &&
    !Array.isArray(proposal.assignments)
  ) {
    throw new Error("Proposal assignments must be an array.");
  }
  if (
    proposal.removeExistingGroups !== undefined &&
    typeof proposal.removeExistingGroups !== "boolean"
  ) {
    throw new Error("removeExistingGroups must be true or false.");
  }

  const plan = buildPlan(inventory, {
    strategy: "keep-windows",
    closeDuplicates: false,
    createGroups: false,
    removeExistingGroups: proposal.removeExistingGroups !== false,
  });
  plan.source = "agent";
  plan.proposalVersion = 1;

  const rowsById = new Map(plan.rows.map((row) => [row.tabId, row]));
  const windowsById = new Map(
    (inventory.windows || []).map((window) => [window.id, window]),
  );
  const assignedIds = new Set();
  const newDestinations = new Map();

  for (const assignment of proposal.assignments || []) {
    if (!assignment || typeof assignment !== "object") {
      throw new Error("Every assignment must be an object.");
    }
    const tabId = requireInteger(assignment.tabId, "Assignment tabId");
    if (assignedIds.has(tabId)) {
      throw new Error(`Tab ${tabId} is assigned more than once.`);
    }
    assignedIds.add(tabId);

    const row = rowsById.get(tabId);
    if (!row) throw new Error(`Tab ${tabId} is not in the current inventory.`);

    if (assignment.destination !== undefined) {
      const destination = assignment.destination;
      if (!destination || typeof destination !== "object") {
        throw new Error(`Tab ${tabId} has an invalid destination.`);
      }
      const hasWindowId = destination.windowId !== undefined;
      const hasNewWindow = destination.newWindow !== undefined;
      if (hasWindowId === hasNewWindow) {
        throw new Error(
          `Tab ${tabId} destination must specify either windowId or newWindow.`,
        );
      }
      if (
        row.protected &&
        (hasNewWindow || destination.windowId !== row.windowId)
      ) {
        throw new Error("Tab Steward cannot move its own dashboard.");
      }

      if (hasWindowId) {
        const windowId = requireInteger(
          destination.windowId,
          `Tab ${tabId} destination windowId`,
        );
        if (!windowsById.has(windowId)) {
          throw new Error(`Destination window ${windowId} does not exist.`);
        }
        row.destinationKey = `existing:${windowId}`;
        row.destinationLabel =
          plan.destinations.find(
            (candidate) => candidate.key === row.destinationKey,
          )?.label || `Window ${windowId}`;
      } else {
        const label = cleanLabel(
          destination.newWindow,
          `Tab ${tabId} newWindow`,
        );
        const key = `new:${label}`;
        row.destinationKey = key;
        row.destinationLabel = `New — ${label}`;
        newDestinations.set(key, {
          key,
          label: `New — ${label}`,
          kind: "new",
        });
      }
    }

    if (assignment.close !== undefined) {
      if (typeof assignment.close !== "boolean") {
        throw new Error(`Tab ${tabId} close must be true or false.`);
      }
      if (assignment.close && row.protected) {
        throw new Error("Tab Steward cannot close its own dashboard.");
      }
      row.close = assignment.close;
    }

    if (assignment.groupTitle !== undefined) {
      if (assignment.groupTitle === "") {
        row.groupTitle = "";
      } else {
        if (row.pinned) {
          throw new Error(`Pinned tab ${tabId} cannot join a native group.`);
        }
        row.groupTitle = cleanLabel(
          assignment.groupTitle,
          `Tab ${tabId} groupTitle`,
        );
      }
    }

    if (assignment.groupColor !== undefined) {
      if (!GROUP_COLORS.has(assignment.groupColor)) {
        throw new Error(`Tab ${tabId} has an unsupported groupColor.`);
      }
      row.groupColor = assignment.groupColor;
    }

    if (
      row.pinned &&
      row.destinationKey !== `existing:${row.windowId}`
    ) {
      throw new Error(`Pinned tab ${tabId} cannot move automatically.`);
    }
  }

  plan.destinations.push(...newDestinations.values());
  plan.newWindows = [...newDestinations.values()].map((destination) => ({
    key: destination.key,
    label: destination.key.slice(4),
  }));
  plan.options.createGroups = plan.rows.some((row) => row.groupTitle);
  recomputeSummary(plan);
  return plan;
}
