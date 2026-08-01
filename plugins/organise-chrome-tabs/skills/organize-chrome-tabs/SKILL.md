---
name: organize-chrome-tabs
description: >-
  Semantically classify and organize or organise live Google Chrome tabs and
  windows with Chrome DevTools and Tab Steward. Use when asked to inventory,
  describe, sort, triage, move, consolidate, clean, or reorganize Chrome tabs;
  create, focus, label, or close Chrome windows; remove native tab groups;
  identify duplicates; distinguish pages from the same site by topic; or
  perform browser hygiene. AI-driven mode is the primary default: Codex owns
  every topic and destination decision, while Tab Steward previews, validates,
  applies, and undoes the reviewed plan. Treat local analysis as a manual
  backup for use without an AI.
---

# Organize Chrome Tabs

Use Chrome DevTools to inspect live pages and Tab Steward to perform native
tab/window mutations. Prefer semantic browser tools over coordinate-driven
desktop automation.

## Modes

### AI-driven mode — primary and default

Use this mode whenever the skill is invoked unless the user explicitly requests
local analysis.

- Perform all semantic classification yourself.
- Decide topic boundaries, window reuse, new window names, and every changed
  tab destination.
- Use Tab Steward only for inventory, proposal validation, preview, mutation,
  undo, and verification.
- Never click **Analyse tabs**, import the local classifier/planner, or use its
  workspaces, scores, or destinations as an AI draft.

### Local fallback mode — manual backup only

The dashboard's **Analyse tabs** feature exists for a person using the extension
without an AI. Use it only when the user explicitly requests local analysis or
asks how to operate Tab Steward manually. Treat its keyword-based output as a
rough proposal requiring human review.

## Defaults

- Organize with windows, not native tab groups.
- Remove existing native groups within the same apply operation.
- Reuse coherent existing windows before creating new ones.
- Prefer the narrowest useful topics; shared domains, vendors, or file types do
  not make tabs one topic.
- Leave pinned tabs in place.
- Detect duplicates but do not close them automatically.
- Never close a tab or window without separate explicit approval.
- Classify YouTube videos by subject rather than as one YouTube category.
- Use title and URL first; inspect content when classification is unclear.
- Keep the Tab Steward dashboard in its current window during apply. Treat it as
  an operational exception and make that window **Browser Tools** when useful.

## AI-driven workflow

1. List live Chrome pages with Chrome DevTools.
2. Reuse an open Tab Steward dashboard. If none is open, discover the installed
   extension and open `dashboard.html`. Never assume a fixed extension ID.
3. Select the dashboard and take a fresh DevTools snapshot before evaluating
   scripts in its context.
4. Request `GET_INVENTORY` with a no-argument `evaluate_script` function. Verify
   the returned `version` is 0.3.0 or newer; if it is missing or any message
   resolves to `undefined`, the loaded build is stale — ask the user to reload
   the extension and stop. Record window, tab, group, and pinned-tab counts plus
   every tab ID and membership.
5. Classify tabs by task or topic. Inspect ambiguous PDFs, generic YouTube pages,
   weak titles, and unclear search results individually.
6. Build a version 1 AI proposal containing only tabs whose destination, group,
   or close state should change. Omitted tabs remain where they are. Never assign
   the dashboard tab to another window.
7. Send `PREVIEW_AGENT_PLAN` from a no-argument evaluated function. Store the
   returned canonical plan in the dashboard page's `globalThis`; return its
   summary for review. Do not pass proposal JSON through `evaluate_script.args`.
8. Report the exact effects: tabs moving, windows created, source windows that
   will become empty, groups removed or created, tabs closing, duplicates, and
   uncertain classifications.
9. Apply when the user explicitly requested organization. Otherwise request
   confirmation. Require separate approval for every close operation.
10. Re-read inventory inside the apply function and compare it with the cached
    plan. If IDs, memberships, or URLs changed, discard the plan and preview a
    new one.
11. Send `APPLY_PLAN` with the unchanged cached canonical plan. Do not reconstruct
    it manually.
12. Request `GET_INVENTORY` again and verify:
    - every original tab ID remains unless closure was approved
    - tabs reached the AI-selected topic windows
    - each final window is semantically coherent
    - created windows contain the expected topics
    - pinned tabs did not move
    - native group count matches the approved plan
    - no accidental empty or temporary windows remain

## Classification

- Classify by actual subject and intended use, not superficial keywords.
- Distinguish broad context from the most useful working topic. For example,
  Apple documentation can belong to IOSurface research, Core Animation, or
  Apple Silicon optimization; `developer.apple.com` is not itself a topic.
- Inspect PDFs whose filenames do not reveal their subjects. Chrome's PDF
  viewer exposes no DOM text, so read them from a screenshot, not `innerText`.
- Inspect generic YouTube pages and weak video titles individually.
- Use a search query's research intent, not merely `google.com`.
- Prefer a few durable windows over needless one-tab windows.
- Keep uncertain tabs in their current window unless moving them is clearly
  useful.
- Treat identical canonical URLs as duplicate candidates, never automatic
  deletions.
- Do not browse the public internet when the live page can be inspected directly.

## Safety and recovery

- `PREVIEW_AGENT_PLAN` is read-only. Use it before every apply; the extension
  rejects any plan that does not match its most recent preview.
- Never click dashboard buttons. Apply, undo, and close use blocking confirm
  dialogs that freeze the page and every later evaluated script. The dashboard
  refreshes its own display after changes.
- Keep the canonical plan only in the dashboard page between preview and apply.
  If the page reloads, navigates, or closes, preview again.
- Never move the dashboard tab during `APPLY_PLAN`; doing so can detach the
  DevTools target and make execution status ambiguous.
- If a target closes or an apply result is unknown, stop and read live inventory.
  Do not retry until verification establishes the actual state.
- Tab Steward stores one pre-change undo snapshot.
- If applying fails partially, stop, re-read inventory, and offer `UNDO_LAST`.
  Do not retry blindly.
- Undo can reopen a closed URL, but cannot recover navigation history, unsaved
  form data, or in-page state.
- Do not invoke undo after later user changes without explaining the snapshot.

Read [references/tab-steward-api.md](references/tab-steward-api.md) before
extension discovery, inventory, proposal preview, apply, verification, recovery,
or local fallback.
