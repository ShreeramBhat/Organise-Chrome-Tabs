# Tab Steward automation API

## Responsibility boundary

In AI-driven mode, Codex owns semantic classification and every destination
decision. Tab Steward owns inventory, proposal validation, canonicalization,
Chrome mutations, and undo.

Do not click **Analyse tabs** or import `lib/classifier.js` or `lib/planner.js`
in AI-driven mode. Those components are the manual local fallback.

## Chrome DevTools connector contract

Follow these rules exactly:

1. Select the Tab Steward dashboard and take a fresh page snapshot after opening,
   reopening, reloading, or reselecting it.
2. Run extension messages with `evaluate_script` in dashboard context.
3. Use no-argument evaluated functions for all message calls.
4. Do **not** use `evaluate_script.args` to pass a proposal, plan, JSON string,
   tab ID, or window ID. In this connector, `args` entries identify DOM elements
   by snapshot UID; arbitrary JSON is interpreted as an element UID and fails.
5. Put the small, AI-authored proposal directly in the no-argument function as a
   JavaScript literal. If generating the function programmatically, serialize
   only agent-owned numeric IDs, booleans, group colors, and reviewed topic
   labels with `JSON.stringify`; never interpolate untrusted page text as code.
6. Cache the canonical preview plan on the dashboard page's `globalThis`. Apply
   that exact object later without reconstructing it or transporting it through
   tool arguments.
7. Omit the dashboard tab from assignments so it remains in its current window.
   Moving the evaluated dashboard tab can detach its DevTools target before the
   apply response returns.

## Extension discovery

The dashboard URL is:

```text
chrome-extension://<extension-id>/dashboard.html
```

Reuse an existing dashboard page. Otherwise discover **Tab Steward** through
`chrome://extensions` and derive the current ID. Never hardcode an unpacked
extension ID.

Runtime messages must be sent from the dashboard extension context.

## Messages

| Message | Input | Purpose | Mutation |
| --- | --- | --- | --- |
| `GET_INVENTORY` | none | Read normal windows, tabs, labels, and groups | No |
| `GET_UNDO_STATE` | none | Check whether one undo snapshot exists | No |
| `PREVIEW_AGENT_PLAN` | `{proposal}` | Validate and canonicalize an AI proposal | No |
| `APPLY_PLAN` | `{plan}` | Apply the unchanged canonical plan | Yes |
| `UNGROUP_ALL` | none | Snapshot, then ungroup all tabs | Yes |
| `UNDO_LAST` | none | Restore the one stored snapshot | Yes |
| `CREATE_WINDOW` | `{label}` | Create a normal Chrome window | Yes |
| `RENAME_WINDOW` | `{windowId,label}` | Store a private dashboard label | Yes |
| `FOCUS_WINDOW` | `{windowId}` | Focus a window | Yes |
| `CLOSE_WINDOW` | `{windowId}` | Snapshot, then close a window | Destructive |

## Read inventory

Use a no-argument evaluated function:

```js
async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_INVENTORY" });
  if (!response?.ok) throw new Error(response?.error || "Inventory failed");
  return response.result;
}
```

## Preview an AI proposal

Use proposal version 1. Omit tabs that should remain unchanged. Never include an
assignment for the Tab Steward dashboard.

```js
async () => {
  const proposal = {
    version: 1,
    removeExistingGroups: true,
    assignments: [
      {
        tabId: 123,
        destination: { windowId: 42 },
      },
      {
        tabId: 124,
        destination: { newWindow: "Machine Learning" },
      },
    ],
  };

  const response = await chrome.runtime.sendMessage({
    type: "PREVIEW_AGENT_PLAN",
    proposal,
  });
  if (!response?.ok) throw new Error(response?.error || "Preview failed");

  globalThis.__tabStewardCanonicalPlan = response.result.plan;
  globalThis.__tabStewardPreview = {
    capturedAt: response.result.capturedAt,
    summary: response.result.summary,
  };
  return globalThis.__tabStewardPreview;
}
```

Each assignment supports:

- `tabId` (required): current integer tab ID.
- `destination`: exactly one of `{windowId: number}` or
  `{newWindow: string}`.
- `groupTitle`: optional native group title. Leave absent or empty for no group.
- `groupColor`: optional Chrome group color.
- `close`: optional boolean. Set true only after explicit approval.

Pinned tabs cannot move or join native groups. The dashboard cannot close
itself. Reusing the same `newWindow` label sends those tabs to one new window.

`PREVIEW_AGENT_PLAN` returns `{plan, summary, capturedAt}`. Present the summary
and any implicit source-window closures before applying.

## Apply the cached canonical plan

Use a no-argument function. Verify live IDs, memberships, and URLs immediately
before apply, then send the cached plan object unchanged:

```js
async () => {
  const plan = globalThis.__tabStewardCanonicalPlan;
  if (!plan) throw new Error("No cached canonical plan; preview again.");

  const inventoryResponse = await chrome.runtime.sendMessage({
    type: "GET_INVENTORY",
  });
  if (!inventoryResponse?.ok) {
    throw new Error(inventoryResponse?.error || "Inventory failed");
  }

  const liveTabs = inventoryResponse.result.windows.flatMap(
    (window) => window.tabs,
  );
  const liveById = new Map(liveTabs.map((tab) => [tab.id, tab]));
  const changed =
    liveTabs.length !== plan.rows.length ||
    plan.rows.some((row) => {
      const live = liveById.get(row.tabId);
      return (
        !live ||
        live.windowId !== row.windowId ||
        live.url !== row.url
      );
    });
  if (changed) {
    delete globalThis.__tabStewardCanonicalPlan;
    delete globalThis.__tabStewardPreview;
    throw new Error("Chrome changed after preview; classify and preview again.");
  }

  const response = await chrome.runtime.sendMessage({
    type: "APPLY_PLAN",
    plan,
  });
  if (!response?.ok) throw new Error(response?.error || "Apply failed");

  delete globalThis.__tabStewardCanonicalPlan;
  delete globalThis.__tabStewardPreview;
  return response.result;
}
```

Do not pass the plan through `evaluate_script.args`. Do not rebuild it from the
summary or original proposal.

## Verification

Request `GET_INVENTORY` again and compare pre/post state by tab ID. Moved tabs
retain IDs; tabs reopened by undo receive new IDs.

Verify:

- every unclosed original tab remains;
- each changed tab reached its AI-selected destination;
- final windows are semantically coherent;
- new windows have the intended topics;
- pinned tabs stayed put;
- native groups match the approved plan;
- duplicates remain unless closure was separately approved;
- no placeholder, empty, or accidental dashboard window remains.

If the dashboard target closes during apply or the tool returns an unknown
result, do not retry. Reopen or reselect the dashboard, read inventory, compare
tab IDs and destinations, then decide whether recovery is needed.

## Local fallback

Local fallback is for a person using the dashboard without an AI. They may click
**Analyse tabs**, review every keyword-based proposal, and apply it manually.
Do not enter this mode during an AI-driven skill run unless explicitly asked.

## Recovery

`APPLY_PLAN`, `CLOSE_WINDOW`, and `UNGROUP_ALL` each replace the single stored
snapshot. Prefer removing groups within `APPLY_PLAN` using
`removeExistingGroups: true`; a later `UNGROUP_ALL` would replace the more useful
pre-organization snapshot.

Undo can reopen closed URLs, but cannot recover navigation history, unsaved form
content, or in-page state. Verify live inventory before invoking undo.
