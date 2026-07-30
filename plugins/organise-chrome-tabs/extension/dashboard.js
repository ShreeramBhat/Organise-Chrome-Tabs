import { buildPlan } from "./lib/planner.js";

const state = {
  inventory: null,
  plan: null,
  busy: false,
};

const elements = {
  statusBanner: document.querySelector("#statusBanner"),
  refreshButton: document.querySelector("#refreshButton"),
  undoButton: document.querySelector("#undoButton"),
  removeGroupsButton: document.querySelector("#removeGroupsButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  applyButton: document.querySelector("#applyButton"),
  browserStats: document.querySelector("#browserStats"),
  windowsList: document.querySelector("#windowsList"),
  planSection: document.querySelector("#planSection"),
  planStats: document.querySelector("#planStats"),
  planRows: document.querySelector("#planRows"),
  strategy: document.querySelector("#strategy"),
  minWindowSize: document.querySelector("#minWindowSize"),
  minGroupSize: document.querySelector("#minGroupSize"),
  reuseWindows: document.querySelector("#reuseWindows"),
  createGroups: document.querySelector("#createGroups"),
  removeExistingGroups: document.querySelector("#removeExistingGroups"),
  closeDuplicates: document.querySelector("#closeDuplicates"),
  createWindowForm: document.querySelector("#createWindowForm"),
  newWindowLabel: document.querySelector("#newWindowLabel"),
  addDestinationForm: document.querySelector("#addDestinationForm"),
  destinationName: document.querySelector("#destinationName"),
};

function setBusy(busy, message = "") {
  state.busy = busy;
  for (const button of document.querySelectorAll("button")) {
    button.disabled = busy || button.dataset.forceDisabled === "true";
  }
  if (busy) showStatus(message || "Working…", "working");
}

function showStatus(message, type = "success") {
  elements.statusBanner.textContent = message;
  elements.statusBanner.className = `status ${type}`;
}

function hideStatus() {
  elements.statusBanner.className = "status hidden";
  elements.statusBanner.textContent = "";
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    throw new Error(response?.error || "The extension did not respond.");
  }
  return response.result;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderStats(container, stats) {
  container.replaceChildren();
  const template = document.querySelector("#statTemplate");
  for (const [label, value] of stats) {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector("strong").textContent = String(value);
    fragment.querySelector("span").textContent = label;
    container.append(fragment);
  }
}

function displayWindowName(window, index) {
  if (window.label) return window.label;
  const active = window.tabs.find((tab) => tab.active) || window.tabs[0];
  return active?.title
    ? `Window ${index + 1} — ${active.title.slice(0, 40)}`
    : `Window ${index + 1}`;
}

function renderInventory() {
  const windows = state.inventory?.windows || [];
  const tabs = windows.flatMap((window) => window.tabs);
  const groups = new Set(
    tabs.filter((tab) => tab.groupId !== -1).map((tab) => tab.groupId),
  );
  renderStats(elements.browserStats, [
    ["windows", windows.length],
    ["tabs", tabs.length],
    ["native groups", groups.size],
    ["pinned", tabs.filter((tab) => tab.pinned).length],
  ]);
  elements.removeGroupsButton.dataset.forceDisabled = groups.size
    ? "false"
    : "true";
  elements.removeGroupsButton.disabled = state.busy || groups.size === 0;

  elements.windowsList.replaceChildren();
  windows.forEach((window, index) => {
    const card = createElement("article", "window-card");
    if (window.focused) card.classList.add("focused");

    const heading = createElement("div", "window-card-heading");
    const titleWrap = createElement("div");
    const title = createElement("h3", "", displayWindowName(window, index));
    const meta = createElement(
      "p",
      "window-meta",
      `${window.tabs.length} tabs · ${window.state}${window.focused ? " · focused" : ""}`,
    );
    titleWrap.append(title, meta);

    const controls = createElement("div", "mini-actions");
    const focusButton = createElement("button", "button tiny ghost", "Focus");
    focusButton.type = "button";
    focusButton.addEventListener("click", () => focusWindow(window.id));

    const closeButton = createElement("button", "button tiny danger", "Close");
    closeButton.type = "button";
    const containsDashboard = window.tabs.some(
      (tab) => tab.url === chrome.runtime.getURL("dashboard.html"),
    );
    if (containsDashboard) {
      closeButton.disabled = true;
      closeButton.dataset.forceDisabled = "true";
      closeButton.title = "This window contains the Tab Steward dashboard.";
    } else {
      closeButton.addEventListener("click", () =>
        closeBrowserWindow(window.id, window.tabs.length),
      );
    }
    controls.append(focusButton, closeButton);
    heading.append(titleWrap, controls);

    const renameForm = createElement("form", "rename-form");
    const renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.name = `window-label-${window.id}`;
    renameInput.maxLength = 80;
    renameInput.value = window.label || "";
    renameInput.placeholder = "Private dashboard label";
    const renameButton = createElement("button", "button tiny secondary", "Save label");
    renameButton.type = "submit";
    renameForm.append(renameInput, renameButton);
    renameForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await renameBrowserWindow(window.id, renameInput.value);
    });

    const sample = createElement("ul", "tab-sample");
    window.tabs.slice(0, 5).forEach((tab) => {
      const item = createElement("li");
      const dot = createElement("span", tab.pinned ? "tab-dot pinned" : "tab-dot");
      const text = createElement("span", "truncate", tab.title || "Untitled");
      item.append(dot, text);
      sample.append(item);
    });
    if (window.tabs.length > 5) {
      sample.append(
        createElement("li", "more-tabs", `+ ${window.tabs.length - 5} more tabs`),
      );
    }

    card.append(heading, renameForm, sample);
    elements.windowsList.append(card);
  });
}

function currentOptions() {
  return {
    strategy: elements.strategy.value,
    minWindowSize: Number(elements.minWindowSize.value) || 3,
    minGroupSize: Number(elements.minGroupSize.value) || 2,
    reuseExistingWindows: elements.reuseWindows.checked,
    createGroups: elements.createGroups.checked,
    removeExistingGroups: elements.removeExistingGroups.checked,
    closeDuplicates: elements.closeDuplicates.checked,
  };
}

function destinationLabel(key) {
  return (
    state.plan.destinations.find((destination) => destination.key === key)
      ?.label || key
  );
}

function updatePlanSummary() {
  if (!state.plan) return;
  const rows = state.plan.rows;
  const moved = rows.filter(
    (row) =>
      !row.close &&
      row.movable &&
      row.destinationKey !== `existing:${row.windowId}`,
  ).length;
  const created = new Set(
    rows
      .filter((row) => !row.close && row.destinationKey.startsWith("new:"))
      .map((row) => row.destinationKey),
  ).size;
  const groups = new Set(
    rows
      .filter((row) => !row.close && row.groupTitle.trim())
      .map((row) => `${row.destinationKey}\u0000${row.groupTitle.trim()}`),
  ).size;
  const closing = rows.filter((row) => row.close).length;

  state.plan.summary = {
    ...state.plan.summary,
    moveCount: moved,
    newWindowCount: created,
    groupCount: groups,
    closeCount: closing,
  };

  renderStats(elements.planStats, [
    ["tabs analysed", rows.length],
    ["tabs moving", moved],
    ["new windows", created],
    ["native groups", groups],
    ["tabs closing", closing],
    ["duplicates found", state.plan.summary.duplicateCount],
  ]);
}

function makeDestinationSelect(row) {
  const select = document.createElement("select");
  select.className = "table-select";
  select.name = `destination-${row.tabId}`;
  for (const destination of state.plan.destinations) {
    const option = document.createElement("option");
    option.value = destination.key;
    option.textContent = destination.label;
    option.selected = destination.key === row.destinationKey;
    select.append(option);
  }
  select.disabled = !row.movable || row.close;
  select.addEventListener("change", () => {
    row.destinationKey = select.value;
    row.destinationLabel = destinationLabel(select.value);
    updatePlanSummary();
  });
  return select;
}

function renderPlan() {
  elements.planSection.classList.remove("hidden");
  elements.planRows.replaceChildren();

  for (const row of state.plan.rows) {
    const tr = document.createElement("tr");
    if (row.close) tr.classList.add("closing-row");
    if (row.protected) tr.classList.add("protected-row");

    const closeCell = document.createElement("td");
    const closeInput = document.createElement("input");
    closeInput.type = "checkbox";
    closeInput.name = `close-${row.tabId}`;
    closeInput.checked = row.close;
    closeInput.disabled = row.protected;
    closeInput.title = row.protected
      ? "The dashboard cannot close itself."
      : "Close this tab when applying the plan.";
    closeInput.addEventListener("change", () => {
      row.close = closeInput.checked;
      tr.classList.toggle("closing-row", row.close);
      destinationSelect.disabled = row.close || !row.movable;
      groupInput.disabled = row.close || row.pinned;
      updatePlanSummary();
    });
    closeCell.append(closeInput);

    const tabCell = document.createElement("td");
    const tabTitle = createElement("strong", "tab-title", row.title);
    const description = createElement("span", "description", row.description);
    const url = createElement("span", "url truncate", row.url);
    const badges = createElement("div", "badges");
    if (row.pinned) badges.append(createElement("span", "badge", "Pinned"));
    if (row.duplicate)
      badges.append(createElement("span", "badge warning", "Duplicate URL"));
    if (row.protected)
      badges.append(createElement("span", "badge", "Dashboard"));
    tabCell.append(tabTitle, description, url, badges);

    const currentCell = createElement("td", "subtle", row.windowName);

    const destinationCell = document.createElement("td");
    const destinationSelect = makeDestinationSelect(row);
    destinationCell.append(destinationSelect);

    const groupCell = document.createElement("td");
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.name = `group-${row.tabId}`;
    groupInput.maxLength = 80;
    groupInput.className = "table-input";
    groupInput.value = row.groupTitle;
    groupInput.placeholder = "Leave blank for no group";
    groupInput.disabled = row.close || row.pinned;
    groupInput.addEventListener("input", () => {
      row.groupTitle = groupInput.value;
      updatePlanSummary();
    });
    groupCell.append(groupInput);

    const signalCell = document.createElement("td");
    const signal = createElement(
      "span",
      `confidence ${row.confidence}`,
      row.confidence,
    );
    signal.title = row.reason;
    signalCell.append(signal);

    tr.append(
      closeCell,
      tabCell,
      currentCell,
      destinationCell,
      groupCell,
      signalCell,
    );
    elements.planRows.append(tr);
  }
  updatePlanSummary();
  elements.planSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refreshInventory({ quiet = false } = {}) {
  if (!quiet) setBusy(true, "Reading Chrome windows and tabs…");
  try {
    state.inventory = await send("GET_INVENTORY");
    renderInventory();
    const undo = await send("GET_UNDO_STATE");
    elements.undoButton.dataset.forceDisabled = undo.available ? "false" : "true";
    elements.undoButton.disabled = state.busy || !undo.available;
    if (!quiet) showStatus("Browser inventory refreshed.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    if (!quiet) setBusy(false);
  }
}

async function analyze() {
  hideStatus();
  setBusy(true, "Analysing tab titles and URLs locally…");
  try {
    state.inventory = await send("GET_INVENTORY");
    renderInventory();
    state.plan = buildPlan(state.inventory, currentOptions());
    renderPlan();
    showStatus(
      `Analysed ${state.plan.rows.length} tabs. Review destinations and groups before applying.`,
      "success",
    );
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function applyPlan() {
  if (!state.plan) return;
  updatePlanSummary();
  const { closeCount, moveCount, newWindowCount } = state.plan.summary;
  const destructiveText = closeCount
    ? ` This will also close ${closeCount} tab${closeCount === 1 ? "" : "s"}.`
    : "";
  const approved = window.confirm(
    `Apply this plan? It will move ${moveCount} tabs and create ${newWindowCount} windows.${destructiveText} An undo snapshot will be saved.`,
  );
  if (!approved) return;

  setBusy(true, "Applying the reviewed plan…");
  try {
    const result = await send("APPLY_PLAN", { plan: state.plan });
    state.inventory = result.inventory;
    state.plan = null;
    elements.planSection.classList.add("hidden");
    renderInventory();
    await refreshInventory({ quiet: true });
    showStatus(result.message, "success");
  } catch (error) {
    showStatus(
      `${error.message} Refresh the inventory before trying again. An undo snapshot may be available.`,
      "error",
    );
  } finally {
    setBusy(false);
  }
}

async function undo() {
  const approved = window.confirm(
    "Restore the tab and window layout captured before the last change?",
  );
  if (!approved) return;
  setBusy(true, "Restoring the previous layout…");
  try {
    const result = await send("UNDO_LAST");
    state.inventory = result.inventory;
    state.plan = null;
    elements.planSection.classList.add("hidden");
    renderInventory();
    await refreshInventory({ quiet: true });
    showStatus(result.message, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function removeAllGroups() {
  const approved = window.confirm(
    "Remove every native tab group while keeping all tabs in their current windows? An undo snapshot will be saved.",
  );
  if (!approved) return;
  setBusy(true, "Removing native tab groups…");
  try {
    const result = await send("UNGROUP_ALL");
    state.inventory = result.inventory;
    state.plan = null;
    elements.planSection.classList.add("hidden");
    renderInventory();
    await refreshInventory({ quiet: true });
    showStatus(result.message, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function focusWindow(windowId) {
  try {
    await send("FOCUS_WINDOW", { windowId });
  } catch (error) {
    showStatus(error.message, "error");
  }
}

async function renameBrowserWindow(windowId, label) {
  setBusy(true, "Saving the private window label…");
  try {
    state.inventory = await send("RENAME_WINDOW", { windowId, label });
    renderInventory();
    showStatus("Window label saved locally.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function closeBrowserWindow(windowId, tabCount) {
  const approved = window.confirm(
    `Close this window and all ${tabCount} tab${tabCount === 1 ? "" : "s"}? An undo snapshot will be saved.`,
  );
  if (!approved) return;
  setBusy(true, "Closing the selected window…");
  try {
    state.inventory = await send("CLOSE_WINDOW", { windowId });
    state.plan = null;
    elements.planSection.classList.add("hidden");
    renderInventory();
    await refreshInventory({ quiet: true });
    showStatus("Window closed. Undo is available.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

elements.refreshButton.addEventListener("click", () => refreshInventory());
elements.analyzeButton.addEventListener("click", analyze);
elements.applyButton.addEventListener("click", applyPlan);
elements.undoButton.addEventListener("click", undo);
elements.removeGroupsButton.addEventListener("click", removeAllGroups);

elements.createWindowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, "Creating a Chrome window…");
  try {
    state.inventory = await send("CREATE_WINDOW", {
      label: elements.newWindowLabel.value,
    });
    elements.newWindowLabel.value = "";
    renderInventory();
    showStatus("Window created.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

elements.addDestinationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const label = elements.destinationName.value.trim();
  if (!label || !state.plan) return;
  let key = `new:${label}`;
  let suffix = 2;
  while (state.plan.destinations.some((destination) => destination.key === key)) {
    key = `new:${label} ${suffix++}`;
  }
  state.plan.destinations.push({ key, label: `New — ${label}`, kind: "new" });
  state.plan.newWindows.push({ key, label });
  elements.destinationName.value = "";
  renderPlan();
});

refreshInventory();
