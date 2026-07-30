# Tab Steward automation API

## Extension discovery

Tab Steward is an unpacked Manifest V3 extension. Its dashboard URL is:

```text
chrome-extension://<extension-id>/dashboard.html
```

Reuse an existing dashboard page when possible. Otherwise discover **Tab
Steward** through the available Chrome extension tools or `chrome://extensions`
and derive the current ID. Never hardcode an unpacked extension ID.

Runtime messages must be sent from the dashboard's extension context:

```js
async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_INVENTORY" });
  if (!response?.ok) throw new Error(response?.error || "Inventory failed");
  return response.result;
}
```

## Messages

| Message | Input | Purpose | Mutation |
| --- | --- | --- | --- |
| `GET_INVENTORY` | none | Read normal windows, tabs, labels, and groups | No |
| `GET_UNDO_STATE` | none | Check whether one undo snapshot exists | No |
| `PREVIEW_AGENT_PLAN` | `{proposal}` | Validate and canonicalize an agent proposal | No |
| `APPLY_PLAN` | `{plan}` | Apply an unchanged canonical plan | Yes |
| `UNGROUP_ALL` | none | Snapshot, then ungroup all tabs | Yes |
| `UNDO_LAST` | none | Restore the one stored snapshot | Yes |
| `CREATE_WINDOW` | `{label}` | Create a normal Chrome window | Yes |
| `RENAME_WINDOW` | `{windowId,label}` | Store a private dashboard label | Yes |
| `FOCUS_WINDOW` | `{windowId}` | Focus a window | Yes |
| `CLOSE_WINDOW` | `{windowId}` | Snapshot, then close a window | Destructive |

## Agent proposal

Use version 1. Omit tabs that should remain unchanged:

```js
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
return response.result;
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

`PREVIEW_AGENT_PLAN` returns `{plan, summary, capturedAt}`. Present `summary` to
the user, then pass the returned `plan` unchanged:

```js
async (plan) => {
  const response = await chrome.runtime.sendMessage({
    type: "APPLY_PLAN",
    plan,
  });
  if (!response?.ok) throw new Error(response?.error || "Apply failed");
  return response.result;
}
```

Do not reconstruct the canonical plan manually after previewing it.

## Count and verify

```js
async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_INVENTORY" });
  if (!response?.ok) throw new Error(response?.error || "Inventory failed");
  const tabs = response.result.windows.flatMap((window) => window.tabs);
  return {
    inventory: response.result,
    windows: response.result.windows.length,
    tabs: tabs.length,
    groups: new Set(
      tabs.filter((tab) => tab.groupId !== -1).map((tab) => tab.groupId),
    ).size,
    pinned: tabs.filter((tab) => tab.pinned).length,
  };
}
```

Moved tabs retain their IDs. Tabs reopened by undo receive new IDs.

## Recovery

`APPLY_PLAN`, `CLOSE_WINDOW`, and `UNGROUP_ALL` each replace the single stored
snapshot. Prefer removing groups within `APPLY_PLAN` using
`removeExistingGroups: true`; a later `UNGROUP_ALL` call would replace the more
useful pre-organization snapshot.
