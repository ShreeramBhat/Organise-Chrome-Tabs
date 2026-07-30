---
name: organize-chrome-tabs
description: Analyze and organize or organise live Google Chrome tabs and windows with Chrome DevTools and the Tab Steward extension. Use when asked to inventory, describe, sort, triage, move, consolidate, clean, or reorganize Chrome tabs; create, focus, label, or close Chrome windows; remove native tab groups; identify duplicate tabs; distinguish multiple pages from the same site by topic; or perform recurring browser hygiene. Preview changes, default to window-only organization, protect pinned tabs, require explicit approval before closing anything, and verify the resulting browser state.
---

# Organize Chrome Tabs

Use Chrome DevTools to inspect pages and Tab Steward to perform native
tab/window mutations. Prefer semantic browser tools over coordinate-driven
desktop automation.

## Defaults

- Organize with windows, not native tab groups.
- Remove existing native groups as part of the same apply operation.
- Reuse coherent existing windows before creating new ones.
- Leave pinned tabs in place.
- Detect duplicates but do not close them automatically.
- Never close a tab or window without separate explicit approval.
- Classify pages from the same site by content. In particular, classify YouTube
  videos by subject rather than putting all YouTube tabs together.
- Use title and URL first; inspect content only when classification is unclear.

## Workflow

1. List live Chrome pages with Chrome DevTools.
2. Reuse an open Tab Steward dashboard. If none is open, discover the installed
   extension and open its `dashboard.html`. Do not assume a fixed extension ID.
3. On the dashboard, request `GET_INVENTORY`. Record window, tab, group, and
   pinned-tab counts plus every tab ID.
4. Classify tabs by task or topic. Inspect ambiguous pages individually using
   visible headings, metadata, or a small DOM snapshot.
5. Build a version 1 agent proposal. Include only tabs that need a changed
   destination, group, or close state; omitted tabs stay where they are.
6. Send `PREVIEW_AGENT_PLAN` with the proposal. Use the returned canonical plan
   and summary; do not hand-edit Chrome state.
7. Report the exact effects: tabs moving, windows created, groups removed or
   created, tabs closing, and uncertain classifications.
8. Apply the returned canonical plan when the user explicitly asked to perform
   the organization. Otherwise ask for confirmation.
9. Require separate explicit approval for every proposal that closes tabs or
   windows, even when the general organization was already authorized.
10. Send `APPLY_PLAN` with the unchanged canonical plan.
11. Request `GET_INVENTORY` again and verify:
    - every original tab ID remains unless closure was approved
    - tabs reached the intended windows
    - created windows contain the expected topics
    - pinned tabs did not move
    - native group count matches the approved plan
    - no accidental empty or temporary windows remain

## Classification

- Prefer a few durable windows over many single-purpose windows.
- Preserve a coherent existing window when most of its tabs share a topic.
- Keep uncertain tabs in their current window unless moving them is clearly
  useful.
- Treat identical canonical URLs as duplicate candidates, never automatic
  deletions.
- Do not browse the public internet to classify a live tab when its live page
  can be inspected directly.

## Safety and recovery

- `PREVIEW_AGENT_PLAN` is read-only. Use it before every agent-authored plan.
- Tab Steward stores one pre-change undo snapshot.
- If applying fails partially, stop and re-read the inventory. Offer
  `UNDO_LAST`; do not retry blindly.
- Undo can reopen a closed URL, but it cannot recover navigation history,
  unsaved form data, or in-page state.
- Do not invoke undo after later user changes without explaining what snapshot
  will be restored.

Read [references/tab-steward-api.md](references/tab-steward-api.md) for
extension discovery, message examples, the proposal schema, verification, and
recovery semantics.
