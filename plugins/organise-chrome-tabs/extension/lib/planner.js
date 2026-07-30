import { classifyTab, colorForWorkspace } from "./classifier.js";

const DEFAULTS = {
  strategy: "topic-windows",
  closeDuplicates: false,
  minGroupSize: 2,
  minWindowSize: 3,
  reuseExistingWindows: true,
  createGroups: false,
  removeExistingGroups: true,
};

export function canonicalizeUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function isOrganizerTab(tab) {
  return (
    tab.url?.startsWith("chrome-extension://") &&
    /tab steward/i.test(tab.title || "")
  );
}

function windowDisplayName(window, index) {
  if (window.label) return window.label;
  const active = window.tabs.find((tab) => tab.active) || window.tabs[0];
  const hint = active?.title?.replace(/\s+/g, " ").trim();
  return hint
    ? `Window ${index + 1} — ${hint.slice(0, 42)}`
    : `Window ${index + 1}`;
}

function chooseExistingWindows(rows, windows, workspaces, options) {
  const assignments = new Map();
  if (!options.reuseExistingWindows) return assignments;

  const claimedWindows = new Set();
  for (const workspace of workspaces) {
    const candidates = windows
      .map((window) => {
        const rowsInWindow = rows.filter(
          (row) => row.windowId === window.id && !row.close && row.movable,
        );
        const matching = rowsInWindow.filter(
          (row) => row.workspace === workspace,
        ).length;
        const ratio = rowsInWindow.length ? matching / rowsInWindow.length : 0;
        return {
          windowId: window.id,
          matching,
          ratio,
          score: matching * 3 + ratio,
        };
      })
      .filter(
        (candidate) =>
          !claimedWindows.has(candidate.windowId) &&
          (candidate.matching >= 2 || candidate.ratio >= 0.6),
      )
      .sort((a, b) => b.score - a.score);

    if (candidates[0]) {
      assignments.set(workspace, `existing:${candidates[0].windowId}`);
      claimedWindows.add(candidates[0].windowId);
    }
  }
  return assignments;
}

export function buildPlan(inventory, suppliedOptions = {}) {
  const options = { ...DEFAULTS, ...suppliedOptions };
  const windows = inventory.windows || [];
  const seenUrls = new Map();
  const duplicateIds = new Set();

  const flattened = windows.flatMap((window, windowIndex) =>
    window.tabs.map((tab) => {
      const canonicalUrl = canonicalizeUrl(tab.url);
      if (
        canonicalUrl &&
        !canonicalUrl.startsWith("chrome://newtab") &&
        !canonicalUrl.startsWith("chrome-extension://")
      ) {
        const previous = seenUrls.get(canonicalUrl);
        if (previous) {
          const keepCurrent =
            (tab.active && !previous.active) ||
            (tab.pinned && !previous.pinned);
          if (keepCurrent) {
            duplicateIds.add(previous.id);
            seenUrls.set(canonicalUrl, tab);
          } else {
            duplicateIds.add(tab.id);
          }
        } else {
          seenUrls.set(canonicalUrl, tab);
        }
      }

      const classification = classifyTab(tab);
      return {
        tabId: tab.id,
        windowId: window.id,
        windowName: windowDisplayName(window, windowIndex),
        title: tab.title || "Untitled",
        url: tab.url || "",
        favIconUrl: tab.favIconUrl || "",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        currentGroupId: tab.groupId,
        movable: !tab.pinned,
        protected: isOrganizerTab(tab),
        duplicate: false,
        close: false,
        ...classification,
      };
    }),
  );

  for (const row of flattened) {
    row.duplicate = duplicateIds.has(row.tabId);
    row.close = options.closeDuplicates && row.duplicate && !row.protected;
  }

  const workspaceCounts = new Map();
  for (const row of flattened) {
    if (row.close || !row.movable) continue;
    workspaceCounts.set(
      row.workspace,
      (workspaceCounts.get(row.workspace) || 0) + 1,
    );
  }

  const largeWorkspaces = [...workspaceCounts.entries()]
    .filter(([, count]) => count >= options.minWindowSize)
    .sort((a, b) => b[1] - a[1])
    .map(([workspace]) => workspace);

  const existingAssignments =
    options.strategy === "topic-windows"
      ? chooseExistingWindows(
          flattened,
          windows,
          largeWorkspaces,
          options,
        )
      : new Map();

  for (const row of flattened) {
    if (row.close || !row.movable || options.strategy === "keep-windows") {
      row.destinationKey = `existing:${row.windowId}`;
      row.destinationLabel = row.windowName;
      continue;
    }

    if ((workspaceCounts.get(row.workspace) || 0) < options.minWindowSize) {
      row.destinationKey = `existing:${row.windowId}`;
      row.destinationLabel = row.windowName;
      continue;
    }

    row.destinationKey =
      existingAssignments.get(row.workspace) || `new:${row.workspace}`;
    row.destinationLabel = row.destinationKey.startsWith("new:")
      ? `New — ${row.workspace}`
      : windows.find(
            (window) =>
              `existing:${window.id}` === row.destinationKey,
          )?.label ||
        flattened.find(
          (candidate) =>
            `existing:${candidate.windowId}` === row.destinationKey,
        )?.windowName ||
        row.destinationKey;
  }

  const groupCounts = new Map();
  for (const row of flattened) {
    if (row.close || row.pinned) continue;
    const key = `${row.destinationKey}\u0000${row.group}`;
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }

  for (const row of flattened) {
    const key = `${row.destinationKey}\u0000${row.group}`;
    row.groupTitle =
      options.createGroups &&
      !row.close &&
      !row.pinned &&
      (groupCounts.get(key) || 0) >= options.minGroupSize
        ? row.group
        : "";
    row.groupColor = colorForWorkspace(row.workspace);
  }

  const newWindows = [...new Set(
    flattened
      .filter((row) => !row.close && row.destinationKey.startsWith("new:"))
      .map((row) => row.destinationKey),
  )].map((key) => ({
    key,
    label: key.slice(4),
  }));

  const moveCount = flattened.filter(
    (row) =>
      !row.close &&
      row.movable &&
      row.destinationKey !== `existing:${row.windowId}`,
  ).length;
  const groupCount = new Set(
    flattened
      .filter((row) => row.groupTitle && !row.close)
      .map((row) => `${row.destinationKey}\u0000${row.groupTitle}`),
  ).size;

  return {
    createdAt: Date.now(),
    options,
    rows: flattened,
    newWindows,
    destinations: [
      ...windows.map((window, index) => ({
        key: `existing:${window.id}`,
        label: windowDisplayName(window, index),
        kind: "existing",
        windowId: window.id,
      })),
      ...newWindows.map((window) => ({
        ...window,
        label: `New — ${window.label}`,
        kind: "new",
      })),
    ],
    summary: {
      tabCount: flattened.length,
      windowCount: windows.length,
      newWindowCount: newWindows.length,
      moveCount,
      groupCount,
      duplicateCount: flattened.filter((row) => row.duplicate).length,
      closeCount: flattened.filter((row) => row.close).length,
      protectedCount: flattened.filter((row) => row.protected).length,
    },
  };
}
