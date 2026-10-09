# Tab Steward automation API

## Responsibility boundary

In AI-driven mode, the AI agent owns semantic classification and every
destination decision. Tab Steward owns inventory, proposal validation,
canonicalization, Chrome mutations, and undo.

Do not click **Analyse tabs** or import `lib/classifier.js` or `lib/planner.js`
in AI-driven mode. Those components are the manual local fallback.

## Connector choice

Claude agents use **Claude in Chrome** (`mcp__claude-in-chrome__*`). Every other
agent uses **Chrome DevTools** (`chrome-devtools` MCP). Each contract below
applies only to its own connector. The messages, proposal format, and
verification are the same for both.

## Claude in Chrome connector contract

Follow these rules exactly:

1. Get the dashboard URL from `python3 scripts/discover_extension.py`. Claude
   in Chrome cannot open `chrome://extensions` or list extensions.
2. Call `tabs_context_mcp`. If no group exists, call it again with
   `createIfEmpty: true`. This opens a new window with one blank tab in Claude's
   group, and that blank tab is active, so no content tab is woken. Navigate
   that blank tab (by its `tabId`) to the dashboard URL. Never navigate, read,
   or script a tab outside Claude's group. Only Claude's own group tabs can be
   targeted anyway; do not add content tabs to it.
3. Run every message with `javascript_tool` (`action: "javascript_exec"`,
   `tabId`: the dashboard tab). The code uses REPL semantics: top-level `await`
   works, and the last expression is the result. Wrap each function from this
   reference as `await (async () => { ... })()`. A bare top-level `return` is a
   syntax error.
4. Put the AI-authored proposal in the code as a JavaScript literal. Apply the
   same serialization rule as DevTools rule 5 below.
5. Cache the `applyToken` on the dashboard's `globalThis`, as in DevTools.
   Reusing the same dashboard `tabId` keeps the page and its globals alive.
6. Omit the dashboard tab and every other Claude-group tab from assignments.
   The inventory lists Claude's window and group like any other; treat them as
   operational, not content.
7. Send `removeExistingGroups: false`. Tab Steward 0.4.0 ungroups every
   grouped, unpinned tab when it is true, including the protected dashboard.
   That would pull the dashboard out of Claude's group and end Claude's access
   to it before verification. Moved tabs still leave their old groups.
8. An `undefined` response means a stale build (see DevTools rule 8). A refusal
   to load the `chrome-extension://` URL, or to run script on it, is a connector
   limitation. Stop and report it. Do not retry or switch connectors without the
   user's approval.
9. Never use `computer`, `find`, or `form_input` on the dashboard. Its buttons
   open blocking `confirm()` dialogs (see DevTools rule 9).
10. After verification, close the dashboard with `tabs_close_mcp`. That removes
    Claude's group and its window. Keep it open only on request.

## Chrome DevTools connector contract

Follow these rules exactly:

1. Select the Tab Steward dashboard and take a fresh page snapshot after opening,
   reopening, reloading, or reselecting it. Open it in a new or blank tab —
   never by navigating a content tab.
2. Run extension messages with `evaluate_script` in dashboard context.
3. Use no-argument evaluated functions for all message calls.
4. Do **not** use `evaluate_script.args` for API data. Connector versions differ
   in argument handling; a no-argument function avoids that incompatibility.
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
   extension build. Stop and ask the user to reload Tab Steward;
   do not improvise a workaround. Builds 0.4.0 and newer
   answer every message, including unknown types, with an explicit `{ok, error}`
   object.
9. Never click dashboard buttons. **Apply plan**, **Undo**, and **Close** open
   blocking `confirm()` dialogs that freeze the page and hang every later
   `evaluate_script` call against it. The dashboard refreshes itself after
   API-driven changes; it never needs a scripted click.

## Version handshake

`GET_INVENTORY` returns `response.result.version` with the running extension
build. Require `0.4.0` or newer before planning. If the field is missing, or
any message resolves to `undefined`, the loaded build predates this API: report
that to the user, ask them to reload the unpacked extension, and stop.

## Extension discovery

The dashboard URL is:

```text
chrome-extension://<extension-id>/dashboard.html
```

On Claude in Chrome, use the local discovery helper below; the rest of this
section is DevTools-specific.

Start the DevTools connector with `--autoConnect --categoryExtensions`. Without the
extension flag, extension targets are hidden and `new_page` rejects dashboard
URLs. This is distinct from a missing Tab Steward runtime version.

Reuse a dashboard ID already known in this connector session or a recent target
listing. If none is known, use `list_extensions` to find the enabled Tab Steward
ID. This extension-enabled tool was verified against the live browser. If that
tool is unavailable, use the read-only local discovery helper from this skill
directory:

```sh
python3 scripts/discover_extension.py
```

For a non-default Chrome data directory, supply `--user-data-dir <path>`.
The helper reads Preferences/Secure Preferences and the registered extension
manifest, returning only matching Tab Steward metadata. It does not load tabs,
modify Chrome settings or print unrelated preferences. Multiple candidates are
not proof of the active profile: match the connector's configured profile, or
clarify if that cannot be determined. The dashboard handshake confirms the
running version; an on-disk version alone does not.

If no recent target listing is available, one `list_pages` call may be used
solely to locate an existing dashboard. It can be slow; do not repeat it or use
its content entries for classification, and never activate targets to unstick it.
If no dashboard exists, open the discovered URL with
`new_page({url, background: true})` and use its returned page ID. Avoid repeated `list_pages`: even opening a page may
produce a full page list, so consume only the dashboard ID. Page IDs belong to
that connector session and differ from native Chrome tab IDs in inventory.
Do not hardcode either kind of ID into the skill.

If the running connector lacks the flag, updating its launch configuration takes
effect after reconnecting. An available extension-enabled connection is usable;
do not restart Chrome or change content tabs to solve connector configuration.
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

Use a no-argument evaluated function. On Claude in Chrome, run the same body as
`await (async () => { ... })()` (see that contract):

```js
async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_INVENTORY" });
  if (!response?.ok) throw new Error(response?.error || "Inventory failed");
  if (!response.result?.version) throw new Error("Missing runtime version");
  globalThis.__tabStewardBefore = response.result;
  return {
    version: response.result.version,
    windows: response.result.windows.map(w => ({
      id: w.id, label: w.label,
      tabs: w.tabs.map(({id, title, url, pinned, groupId, active, discarded}) =>
        ({id, title, url, pinned, groupId, active, discarded}))
    }))
  };
}
```

Retain the complete baseline in the dashboard and return compact output. Some
0.4.0 builds omit `mutedInfo`; do not report a comparison unless both inventories
contain it or a separate read-only metadata baseline was captured.

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
For tab-preserving organization on 0.4.0, follow the main skill's persistent
blank lead procedure instead: `CREATE_WINDOW` first, then `{windowId}`. A
`CREATE_WINDOW` result is an inventory, not a direct window object; compare its
window IDs with the cached inventory, store the new window and blank tab IDs,
and return only those IDs. Do not print an entire inventory for every creation.
Creating/renaming several windows must be sequential: labels share storage.

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
  return {
    message: response.result.message,
    execution: response.result.execution,
  };
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

Request `GET_INVENTORY` again and compare pre/post state by tab ID. On Claude in
Chrome, exclude Claude's own window, group, and dashboard tab from the
comparison, and expect user groups on tabs that stayed put to remain. Keep the
original baseline: do not rerun the initial caching example and overwrite it.
Moved tabs retain IDs; tabs reopened by undo receive new IDs.

Verify:

- every unclosed original tab remains;
- each changed tab reached its AI-selected destination;
- final windows are semantically coherent;
- new windows have the intended topics;
- pinned tabs stayed put;
- native groups match the approved plan;
- duplicates remain unless closure was separately approved;
- only deliberately retained blank lead tabs remain; no unexplained additions;
- original active tabs remain active and discarded tabs were not woken;
- available audio metadata matches the baseline (report unavailable fields).

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
