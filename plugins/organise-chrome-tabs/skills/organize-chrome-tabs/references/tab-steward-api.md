# Tab Steward automation API

## Responsibility boundary

In AI-driven mode, the AI agent owns semantic classification and every
destination decision. Tab Steward owns inventory, proposal validation,
canonicalization, Chrome mutations, and undo.

Do not click **Analyse tabs** or import `lib/classifier.js` or `lib/planner.js`
in AI-driven mode. Those components are the manual local fallback.

## Tab preservation

Chrome discards or freezes background tabs to save memory. A discarded tab has
no renderer and **reloads when activated**, and a reloaded page may autoplay
with sound once the origin passes the user's Media Engagement Index threshold.
Every rule below exists to keep the agent from waking a tab.

- The dashboard tab is the **only** permitted DevTools target. Never run
  `evaluate_script`, `take_snapshot`, `wait_for`, or `navigate_page` against a
  content tab, and never `select_page({bringToFront: true})` one.
- Do not build inventory from `list_pages`. It attaches per-target, can hang on
  frozen tabs, and the known workaround is `Target.activateTarget` — the exact
  reload to avoid. Use `GET_INVENTORY`.
- `GET_INVENTORY` proxies `chrome.tabs.query`, so `id`, `url`, `title`,
  `discarded`, `audible`, and `mutedInfo` are all available for discarded tabs
  **without loading them**. The DevTools page list may show unloaded tabs as
  bare URLs with no title; the inventory does not.
- Never send `chrome.tabs.update` with `muted`, and never set
  `autoDiscardable`. Audio and memory state belong to the user.
- Moves are renderer-free and safe. Creating a window is not: its first tab
  becomes active. Give every new window a blank `chrome://newtab/` lead tab, or
  order assignments so no content tab is left active there.
- Resolve ambiguous tabs out of band. For YouTube, fetch
  `https://www.youtube.com/oembed?url=<watch-url>&format=json` from your own
  network stack for the real title and channel. If a tab still cannot be
  classified, stop and ask the user before loading it.
- After apply, assert that no tab's `mutedInfo.muted` changed and that no
  previously `discarded` tab became loaded.

## Chrome DevTools connector contract

Follow these rules exactly:

1. Select the Tab Steward dashboard and take a fresh page snapshot after opening,
   reopening, reloading, or reselecting it. Open it in a new or blank tab —
   never by navigating a content tab.
2. Run extension messages with `evaluate_script` in dashboard context.
3. Use no-argument evaluated functions for all message calls.
4. Do **not** use `evaluate_script.args` to pass a proposal, token, JSON string,
   tab ID, or window ID. In this connector, `args` entries identify DOM elements
   by snapshot UID; arbitrary JSON is interpreted as an element UID and fails.
5. Put the small, AI-authored proposal directly in the no-argument function as a
   JavaScript literal. If generating the function programmatically, serialize
   only agent-owned numeric IDs, booleans, group colors, and reviewed topic
   labels with `JSON.stringify`; never interpolate untrusted page text as code.
6. Cache the preview's `applyToken` on the dashboard page's `globalThis`. The
   canonical plan stays inside the extension service worker and does not cross
   the runtime message boundary.
7. Omit the dashboard tab from assignments so it remains in its current window.
   Moving the evaluated dashboard tab can detach its DevTools target before the
   apply response returns. The extension also rejects proposals that move or
   close it.
8. Treat an `undefined` response from `chrome.runtime.sendMessage` as a stale
   extension build. Stop and ask the user to reload Tab Steward from
   `chrome://extensions`; do not improvise a workaround. Builds 0.4.0 and newer
   answer every message, including unknown types, with an explicit `{ok, error}`
   object.
9. Never click dashboard buttons. **Apply plan**, **Undo**, and **Close** open
   blocking `confirm()` dialogs that freeze the page and hang every later
   `evaluate_script` call against it. The dashboard refreshes itself after
   API-driven changes; it never needs a scripted click.

## Version handshake

`GET_INVENTORY` returns a top-level `version` field with the running extension
build. Require `0.4.0` or newer before planning. If the field is missing, or
any message resolves to `undefined`, the loaded build predates this API: report
that to the user, ask them to reload the unpacked extension, and stop.

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
| `APPLY_PREVIEWED_PLAN` | `{applyToken}` | Apply the internally stored canonical plan | Yes |
| `APPLY_PLAN` | `{plan}` | Legacy compatibility path for 0.3 clients | Yes |
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

  globalThis.__tabStewardApplyToken = response.result.applyToken;
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

`PREVIEW_AGENT_PLAN` returns `{applyToken, summary, capturedAt}`. Present the
summary and any implicit source-window closures before applying. The extension
stores the full canonical plan internally, so its size does not make the preview
response or apply request grow with the total tab inventory. Each preview
replaces the previous pending plan and token.

For compatibility with a 0.3 caller that still uses `APPLY_PLAN`, pass
`includePlan: true` to `PREVIEW_AGENT_PLAN`. New integrations must use the token
protocol above; the compatibility response includes the full plan and therefore
does not have the bounded-response benefit.

## Apply the previewed plan

Use a no-argument function and send the cached token unchanged:

```js
async () => {
  const applyToken = globalThis.__tabStewardApplyToken;
  if (!applyToken) throw new Error("No cached apply token; preview again.");

  const response = await chrome.runtime.sendMessage({
    type: "APPLY_PREVIEWED_PLAN",
    applyToken,
  });
  if (!response?.ok) throw new Error(response?.error || "Apply failed");

  delete globalThis.__tabStewardApplyToken;
  delete globalThis.__tabStewardPreview;
  return response.result;
}
```

Do not pass the token through `evaluate_script.args` or reconstruct anything
from the summary or original proposal. A token applies only the most recently
previewed canonical plan.

Check staleness only for the tabs the plan changes. Unrelated tabs navigate,
redirect, and close constantly; requiring the whole browser to stay frozen
between preview and apply makes applying impossible. The extension verifies the
ID, window, URL, pinned state, and group of each affected tab immediately before
mutation. If one changed, it rejects the plan and clears the pending token so
the next apply demands a fresh preview.

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

`APPLY_PREVIEWED_PLAN`, `CLOSE_WINDOW`, and `UNGROUP_ALL` each replace the single
stored snapshot. Prefer removing groups within `APPLY_PREVIEWED_PLAN` using
`removeExistingGroups: true`; a later `UNGROUP_ALL` would replace the more useful
pre-organization snapshot.

Undo can reopen closed URLs, but cannot recover navigation history, unsaved form
content, or in-page state. Verify live inventory before invoking undo.
