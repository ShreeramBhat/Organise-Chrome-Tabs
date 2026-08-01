import { buildAgentPlan } from "./lib/agent-plan.js";

const DASHBOARD_URL = chrome.runtime.getURL("dashboard.html");
const SNAPSHOT_KEY = "lastOrganizationSnapshot";
const WINDOW_LABELS_KEY = "windowLabels";
const PENDING_PLAN_KEY = "pendingCanonicalPlan";

// storage.session is unavailable in the test harness's chrome mock.
function planStore() {
  return chrome.storage.session ?? chrome.storage.local;
}

async function storePendingPlan(plan) {
  await planStore().set({
    [PENDING_PLAN_KEY]: { planJson: JSON.stringify(plan), storedAt: Date.now() },
  });
}

async function clearPendingPlan() {
  await planStore().remove(PENDING_PLAN_KEY);
}

async function assertPlanWasPreviewed(plan) {
  const stored = (await planStore().get(PENDING_PLAN_KEY))[PENDING_PLAN_KEY];
  if (!stored) {
    throw new Error(
      "No previewed plan is pending. Send PREVIEW_AGENT_PLAN first, then apply the returned canonical plan unchanged.",
    );
  }
  if (JSON.stringify(plan) !== stored.planJson) {
    throw new Error(
      "This plan does not match the previewed canonical plan. Preview again and apply the returned plan unchanged.",
    );
  }
}

async function getStoredWindowLabels() {
  const result = await chrome.storage.local.get(WINDOW_LABELS_KEY);
  return result[WINDOW_LABELS_KEY] || {};
}

async function setStoredWindowLabels(labels) {
  await chrome.storage.local.set({ [WINDOW_LABELS_KEY]: labels });
}

async function getInventory() {
  const [windows, groups, labels] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
    chrome.tabGroups.query({}),
    getStoredWindowLabels(),
  ]);

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const liveWindowIds = new Set(windows.map((window) => String(window.id)));
  const cleanedLabels = Object.fromEntries(
    Object.entries(labels).filter(([windowId]) => liveWindowIds.has(windowId)),
  );

  if (Object.keys(cleanedLabels).length !== Object.keys(labels).length) {
    await setStoredWindowLabels(cleanedLabels);
  }

  return {
    capturedAt: Date.now(),
    version: chrome.runtime.getManifest().version,
    windows: windows.map((window) => ({
      id: window.id,
      focused: window.focused,
      incognito: window.incognito,
      state: window.state,
      type: window.type,
      label: cleanedLabels[window.id] || "",
      tabs: (window.tabs || []).map((tab) => {
        const group = groupsById.get(tab.groupId);
        return {
          id: tab.id,
          windowId: tab.windowId,
          index: tab.index,
          active: tab.active,
          pinned: tab.pinned,
          audible: tab.audible,
          discarded: tab.discarded,
          groupId: tab.groupId,
          title: tab.title || "",
          url: tab.url || tab.pendingUrl || "",
          favIconUrl: tab.favIconUrl || "",
          group: group
            ? {
                id: group.id,
                title: group.title || "",
                color: group.color,
                collapsed: group.collapsed,
              }
            : null,
        };
      }),
    })),
  };
}

async function captureSnapshot(reason) {
  const inventory = await getInventory();
  const snapshot = {
    version: 1,
    reason,
    capturedAt: Date.now(),
    inventory,
    execution: null,
  };
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
  return snapshot;
}

async function getUndoState() {
  const result = await chrome.storage.local.get(SNAPSHOT_KEY);
  const snapshot = result[SNAPSHOT_KEY];
  return {
    available: Boolean(snapshot),
    capturedAt: snapshot?.capturedAt || null,
    reason: snapshot?.reason || "",
  };
}

async function tabExists(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function windowExists(windowId) {
  try {
    return await chrome.windows.get(windowId, { populate: true });
  } catch {
    return null;
  }
}

async function safeUngroup(tabIds) {
  if (!tabIds.length) return;
  try {
    await chrome.tabs.ungroup(tabIds);
  } catch {
    for (const tabId of tabIds) {
      try {
        await chrome.tabs.ungroup(tabId);
      } catch {
        // The tab may already be ungrouped or may have closed.
      }
    }
  }
}

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.rows)) {
    throw new Error("The organization plan is missing or invalid.");
  }

  if (!Array.isArray(plan.destinations)) {
    throw new Error("The organization plan has no destinations.");
  }
  const destinationKeys = new Set();
  for (const destination of plan.destinations) {
    if (
      !destination ||
      typeof destination.key !== "string" ||
      destinationKeys.has(destination.key)
    ) {
      throw new Error("The plan contains an invalid or duplicate destination.");
    }
    if (
      destination.kind !== "existing" &&
      destination.kind !== "new"
    ) {
      throw new Error(`Destination ${destination.key} has an invalid kind.`);
    }
    if (
      destination.kind === "existing" &&
      !Number.isInteger(destination.windowId)
    ) {
      throw new Error(`Destination ${destination.key} has no window ID.`);
    }
    destinationKeys.add(destination.key);
  }

  const tabIds = new Set();
  for (const row of plan.rows) {
    if (!Number.isInteger(row.tabId) || tabIds.has(row.tabId)) {
      throw new Error("The plan contains an invalid or duplicate tab ID.");
    }
    tabIds.add(row.tabId);

    if (
      typeof row.destinationKey !== "string" ||
      (!row.destinationKey.startsWith("existing:") &&
        !row.destinationKey.startsWith("new:")) ||
      !destinationKeys.has(row.destinationKey)
    ) {
      throw new Error(`Tab ${row.tabId} has an invalid destination.`);
    }
    if (typeof row.close !== "boolean") {
      throw new Error(`Tab ${row.tabId} has an invalid close value.`);
    }
    if (
      typeof row.groupTitle !== "string" ||
      row.groupTitle.length > 80
    ) {
      throw new Error(`Tab ${row.tabId} has an invalid group title.`);
    }
    if (row.protected && row.close) {
      throw new Error("Tab Steward cannot close its own dashboard.");
    }
    if (row.protected && row.destinationKey !== `existing:${row.windowId}`) {
      throw new Error("Tab Steward cannot move its own dashboard.");
    }
    if (row.pinned && row.destinationKey !== `existing:${row.windowId}`) {
      throw new Error("Pinned tabs must be unpinned before moving them.");
    }
  }
}

async function createDestinationWindows(plan, execution) {
  const destinationIds = new Map();
  const referencedKeys = new Set(
    plan.rows
      .filter((row) => !row.close)
      .map((row) => row.destinationKey),
  );
  for (const destination of plan.destinations || []) {
    if (destination.kind === "existing") {
      if (!referencedKeys.has(destination.key)) continue;
      const current = await windowExists(destination.windowId);
      if (!current) {
        throw new Error(
          `Destination window ${destination.windowId} no longer exists. Refresh and preview the plan again.`,
        );
      }
      destinationIds.set(destination.key, destination.windowId);
    }
  }

  const neededKeys = [
    ...new Set(
      plan.rows
        .filter((row) => !row.close && row.destinationKey.startsWith("new:"))
        .map((row) => row.destinationKey),
    ),
  ];

  for (const key of neededKeys) {
    const created = await chrome.windows.create({ focused: false });
    if (!created?.id) throw new Error(`Could not create ${key.slice(4)}.`);

    destinationIds.set(key, created.id);
    execution.createdWindowIds.push(created.id);
    for (const tab of created.tabs || []) {
      execution.placeholderTabIds.push(tab.id);
    }

    const labels = await getStoredWindowLabels();
    labels[created.id] = key.slice(4);
    await setStoredWindowLabels(labels);
  }

  return destinationIds;
}

async function applyGroups(rows, destinationIds) {
  const groups = new Map();
  for (const row of rows) {
    if (row.close || row.pinned || !row.groupTitle) continue;
    const windowId = destinationIds.get(row.destinationKey);
    if (!windowId) continue;
    const key = `${windowId}\u0000${row.groupTitle}`;
    if (!groups.has(key)) {
      groups.set(key, {
        windowId,
        title: row.groupTitle.slice(0, 80),
        color: row.groupColor || "grey",
        tabIds: [],
      });
    }
    groups.get(key).tabIds.push(row.tabId);
  }

  const existingGroups = await chrome.tabGroups.query({});
  for (const groupSpec of groups.values()) {
    const liveTabIds = [];
    for (const tabId of groupSpec.tabIds) {
      const tab = await tabExists(tabId);
      if (tab && tab.windowId === groupSpec.windowId && !tab.pinned) {
        liveTabIds.push(tabId);
      }
    }
    if (!liveTabIds.length) continue;

    const matching = existingGroups.find(
      (group) =>
        group.windowId === groupSpec.windowId &&
        group.title === groupSpec.title,
    );
    const groupId = matching
      ? await chrome.tabs.group({
          tabIds: liveTabIds,
          groupId: matching.id,
        })
      : await chrome.tabs.group({
          tabIds: liveTabIds,
          createProperties: { windowId: groupSpec.windowId },
        });

    await chrome.tabGroups.update(groupId, {
      title: groupSpec.title,
      color: groupSpec.color,
      collapsed: false,
    });
  }
}

function rowChangesState(plan, row) {
  return (
    row.close ||
    row.groupTitle !== "" ||
    (row.movable && row.destinationKey !== `existing:${row.windowId}`) ||
    Boolean(plan.options?.removeExistingGroups && row.currentGroupId !== -1)
  );
}

async function applyPlan(plan) {
  await assertPlanWasPreviewed(plan);
  validatePlan(plan);

  // Unrelated tabs closing must not invalidate the plan; only tabs the plan
  // actually changes make it stale.
  const liveRows = [];
  const missingTabIds = [];
  for (const row of plan.rows) {
    if (await tabExists(row.tabId)) liveRows.push(row);
    else if (rowChangesState(plan, row)) missingTabIds.push(row.tabId);
  }
  if (missingTabIds.length) {
    await clearPendingPlan();
    throw new Error(
      `The plan is stale because ${missingTabIds.length} tab${
        missingTabIds.length === 1 ? "" : "s"
      } changed. Refresh and preview it again.`,
    );
  }
  if (!liveRows.length) {
    await clearPendingPlan();
    throw new Error("None of the planned tabs still exist.");
  }

  const referencedExistingKeys = new Set(
    liveRows
      .filter(
        (row) =>
          !row.close && row.destinationKey.startsWith("existing:"),
      )
      .map((row) => row.destinationKey),
  );
  for (const destination of plan.destinations) {
    if (
      destination.kind === "existing" &&
      referencedExistingKeys.has(destination.key) &&
      !(await windowExists(destination.windowId))
    ) {
      await clearPendingPlan();
      throw new Error(
        `Destination window ${destination.windowId} no longer exists. Refresh and preview the plan again.`,
      );
    }
  }

  const snapshot = await captureSnapshot("Before organization");
  const execution = {
    createdWindowIds: [],
    placeholderTabIds: [],
    closedTabIds: [],
    startedAt: Date.now(),
  };

  const destinationIds = await createDestinationWindows(plan, execution);

  const regroupableIds = liveRows
    .filter(
      (row) =>
        !row.pinned &&
        row.currentGroupId !== -1 &&
        (plan.options?.removeExistingGroups ||
          row.destinationKey !== `existing:${row.windowId}`),
    )
    .map((row) => row.tabId);
  await safeUngroup(regroupableIds);
  execution.ungroupedTabIds = regroupableIds;

  const movesByDestination = new Map();
  for (const row of liveRows) {
    if (row.close || !row.movable) continue;
    const targetWindowId = destinationIds.get(row.destinationKey);
    if (!targetWindowId || targetWindowId === row.windowId) continue;
    const moveKey = `${targetWindowId}\u0000${row.windowId}`;
    if (!movesByDestination.has(moveKey)) {
      movesByDestination.set(moveKey, { targetWindowId, tabIds: [] });
    }
    movesByDestination.get(moveKey).tabIds.push(row.tabId);
  }

  const protectedDestinationIds = new Set(
    [...movesByDestination.values()].map((move) => move.targetWindowId),
  );
  for (const targetWindowId of protectedDestinationIds) {
    if (execution.createdWindowIds.includes(targetWindowId)) continue;
    const placeholder = await chrome.tabs.create({
      windowId: targetWindowId,
      url: "chrome://newtab/",
      active: false,
    });
    execution.placeholderTabIds.push(placeholder.id);
  }

  for (const { targetWindowId, tabIds } of movesByDestination.values()) {
    const existingTabIds = [];
    for (const tabId of tabIds) {
      if (await tabExists(tabId)) existingTabIds.push(tabId);
    }
    if (existingTabIds.length) {
      await chrome.tabs.move(existingTabIds, {
        windowId: targetWindowId,
        index: -1,
      });
    }
  }

  for (const placeholderId of execution.placeholderTabIds) {
    if (await tabExists(placeholderId)) {
      await chrome.tabs.remove(placeholderId);
    }
  }

  await applyGroups(liveRows, destinationIds);

  for (const row of liveRows.filter((candidate) => candidate.close)) {
    if (row.protected) continue;
    if (await tabExists(row.tabId)) {
      execution.closedTabIds.push(row.tabId);
      await chrome.tabs.remove(row.tabId);
    }
  }

  execution.completedAt = Date.now();
  snapshot.execution = execution;
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
  await clearPendingPlan();

  return {
    inventory: await getInventory(),
    execution,
    message: `Organized ${liveRows.length} tabs.`,
  };
}

async function restoreGroups(snapshotTabs, restoredTabIdsByOriginalId) {
  const specs = new Map();
  for (const original of snapshotTabs) {
    if (!original.group || original.pinned) continue;
    const restoredId = restoredTabIdsByOriginalId.get(original.id);
    const live = restoredId ? await tabExists(restoredId) : null;
    if (!live) continue;
    const key = `${live.windowId}\u0000${original.group.title}\u0000${original.group.color}`;
    if (!specs.has(key)) {
      specs.set(key, {
        windowId: live.windowId,
        title: original.group.title,
        color: original.group.color,
        collapsed: original.group.collapsed,
        tabIds: [],
      });
    }
    specs.get(key).tabIds.push(restoredId);
  }

  for (const spec of specs.values()) {
    const groupId = await chrome.tabs.group({
      tabIds: spec.tabIds,
      createProperties: { windowId: spec.windowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: spec.title,
      color: spec.color,
      collapsed: spec.collapsed,
    });
  }
}

async function undoLastOrganization() {
  const stored = await chrome.storage.local.get(SNAPSHOT_KEY);
  const snapshot = stored[SNAPSHOT_KEY];
  if (!snapshot?.inventory?.windows) {
    throw new Error("There is no organization snapshot to restore.");
  }

  const restoredTabIdsByOriginalId = new Map();
  const restoredWindowIdsByOriginalId = new Map();
  const originalTabs = snapshot.inventory.windows.flatMap(
    (window) => window.tabs,
  );
  const originalTabIds = new Set(originalTabs.map((tab) => tab.id));
  await safeUngroup(
    (
      await getInventory()
    ).windows.flatMap((window) =>
      window.tabs
        .filter(
          (tab) => tab.groupId !== -1 && originalTabIds.has(tab.id),
        )
        .map((tab) => tab.id),
    ),
  );

  for (const originalWindow of snapshot.inventory.windows) {
    const originalLiveTabs = [];
    for (const originalTab of originalWindow.tabs) {
      const current = await tabExists(originalTab.id);
      if (current) originalLiveTabs.push(current);
    }

    let targetWindow = await windowExists(originalWindow.id);
    let placeholderId = null;
    if (!targetWindow) {
      targetWindow = await chrome.windows.create({ focused: false });
      placeholderId = targetWindow?.tabs?.[0]?.id || null;
    }
    if (!targetWindow?.id) continue;
    restoredWindowIdsByOriginalId.set(originalWindow.id, targetWindow.id);

    for (const originalTab of originalWindow.tabs) {
      let current = await tabExists(originalTab.id);
      if (!current) {
        current = await chrome.tabs.create({
          windowId: targetWindow.id,
          url: originalTab.url || "chrome://newtab/",
          active: false,
          pinned: false,
        });
      } else if (current.windowId !== targetWindow.id) {
        if (current.pinned) {
          await chrome.tabs.update(current.id, { pinned: false });
        }
        current = await chrome.tabs.move(current.id, {
          windowId: targetWindow.id,
          index: -1,
        });
      }
      restoredTabIdsByOriginalId.set(originalTab.id, current.id);
    }

    if (placeholderId && (await tabExists(placeholderId))) {
      await chrome.tabs.remove(placeholderId);
    }

    for (const originalTab of [...originalWindow.tabs].sort(
      (a, b) => a.index - b.index,
    )) {
      const restoredId = restoredTabIdsByOriginalId.get(originalTab.id);
      if (!(await tabExists(restoredId))) continue;
      await chrome.tabs.update(restoredId, { pinned: originalTab.pinned });
      await chrome.tabs.move(restoredId, {
        windowId: targetWindow.id,
        index: originalTab.index,
      });
    }

    const activeOriginal = originalWindow.tabs.find((tab) => tab.active);
    const activeRestoredId = activeOriginal
      ? restoredTabIdsByOriginalId.get(activeOriginal.id)
      : null;
    if (activeRestoredId && (await tabExists(activeRestoredId))) {
      await chrome.tabs.update(activeRestoredId, { active: true });
    }
  }

  await restoreGroups(originalTabs, restoredTabIdsByOriginalId);

  const labels = await getStoredWindowLabels();
  for (const originalWindow of snapshot.inventory.windows) {
    const restoredWindowId = restoredWindowIdsByOriginalId.get(
      originalWindow.id,
    );
    if (originalWindow.label && restoredWindowId) {
      labels[restoredWindowId] = originalWindow.label;
    }
  }
  await setStoredWindowLabels(labels);
  await chrome.storage.local.remove(SNAPSHOT_KEY);

  return {
    inventory: await getInventory(),
    message: "The previous tab and window layout was restored.",
  };
}

async function createWindow(label) {
  const created = await chrome.windows.create({ focused: true });
  if (!created?.id) throw new Error("Chrome did not create the window.");
  if (label?.trim()) {
    const labels = await getStoredWindowLabels();
    labels[created.id] = label.trim().slice(0, 80);
    await setStoredWindowLabels(labels);
  }
  return getInventory();
}

async function renameWindow(windowId, label) {
  if (!(await windowExists(windowId))) {
    throw new Error("That window no longer exists.");
  }
  const labels = await getStoredWindowLabels();
  if (label?.trim()) labels[windowId] = label.trim().slice(0, 80);
  else delete labels[windowId];
  await setStoredWindowLabels(labels);
  return getInventory();
}

async function closeWindow(windowId) {
  const window = await windowExists(windowId);
  if (!window) throw new Error("That window no longer exists.");
  await captureSnapshot("Before closing a window");
  await chrome.windows.remove(windowId);
  return getInventory();
}

async function ungroupAll() {
  const inventory = await getInventory();
  const groupedTabIds = inventory.windows.flatMap((window) =>
    window.tabs
      .filter((tab) => tab.groupId !== -1)
      .map((tab) => tab.id),
  );
  if (!groupedTabIds.length) {
    return {
      inventory,
      message: "There were no native tab groups to remove.",
    };
  }

  await captureSnapshot("Before removing all tab groups");
  await safeUngroup(groupedTabIds);
  return {
    inventory: await getInventory(),
    message: `Removed native groups from ${groupedTabIds.length} tabs without moving them.`,
  };
}

async function focusWindow(windowId) {
  const window = await windowExists(windowId);
  if (!window) throw new Error("That window no longer exists.");
  await chrome.windows.update(windowId, { focused: true });
  return true;
}

async function previewAgentPlan(proposal) {
  const inventory = await getInventory();
  const plan = buildAgentPlan(inventory, proposal);
  validatePlan(plan);
  plan.applyToken = crypto.randomUUID();
  await storePendingPlan(plan);
  return {
    plan,
    summary: plan.summary,
    capturedAt: inventory.capturedAt,
  };
}

async function openDashboard() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(DASHBOARD_URL));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD_URL });
}

chrome.action.onClicked.addListener(() => {
  openDashboard().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    GET_INVENTORY: getInventory,
    GET_UNDO_STATE: getUndoState,
    PREVIEW_AGENT_PLAN: () => previewAgentPlan(message.proposal),
    APPLY_PLAN: () => applyPlan(message.plan),
    UNDO_LAST: undoLastOrganization,
    CREATE_WINDOW: () => createWindow(message.label),
    RENAME_WINDOW: () => renameWindow(message.windowId, message.label),
    CLOSE_WINDOW: () => closeWindow(message.windowId),
    UNGROUP_ALL: ungroupAll,
    FOCUS_WINDOW: () => focusWindow(message.windowId),
  };

  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({
      ok: false,
      error: `Unknown message type "${message?.type}". Tab Steward may be running an outdated build; reload it from chrome://extensions and retry.`,
    });
    return false;
  }

  handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return true;
});
