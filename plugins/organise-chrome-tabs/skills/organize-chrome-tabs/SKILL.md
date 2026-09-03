---
name: organize-chrome-tabs
description: >-
  Semantically classify and organize or organise live Google Chrome tabs and
  windows with Chrome DevTools and Tab Steward. Use when asked to inventory,
  describe, sort, triage, move, consolidate, clean, or reorganize Chrome tabs;
  create, focus, label, or close Chrome windows; remove native tab groups;
  identify duplicates; distinguish pages from the same site by topic; or
  perform browser hygiene. AI-driven mode is the primary default: the AI agent
  owns every topic and destination decision, while Tab Steward previews,
  validates, applies, and undoes the reviewed plan. The workflow never wakes,
  reloads, activates, mutes, or unmutes a content tab. Treat local analysis as
  a manual backup for use without an AI.
---

# Organize Chrome Tabs

Use Tab Steward for all browser state and all native tab/window mutations. Use
Chrome DevTools for exactly one thing: evaluating script inside the Tab Steward
dashboard tab. Prefer semantic browser tools over coordinate-driven desktop
automation. Never use Computer Use for this workflow.

## Tab preservation — read this before any tool call

Real profiles hold hundreds of tabs that Chrome has discarded or frozen to save
memory. A discarded tab keeps its strip entry but has no renderer, and its
content **reloads the moment it is activated**. On a reload, Chrome permits
autoplay with sound once the origin passes the user's Media Engagement Index
threshold — which for a heavy YouTube user is effectively always. A careless
inspection therefore starts audio the user did not ask for.

Treat these as hard rules:

- **Never run `evaluate_script`, `take_snapshot`, `wait_for`, `navigate_page`,
  `click`, `hover`, or `press_key` against a content tab.** Those need a live
  renderer and will wake a discarded tab. The dashboard tab is the sole
  permitted DevTools target.
- **Never call `select_page` with `bringToFront: true`** on a content tab.
  Activating a discarded tab reloads it.
- **Do not use `list_pages` to build inventory.** It attaches per-target and can
  hang on frozen tabs; the documented workaround is `Target.activateTarget`,
  which is precisely the reload this skill must avoid. `GET_INVENTORY` is the
  only sanctioned inventory source.
- **Never change audio state.** Do not call `chrome.tabs.update` with `muted`,
  and never "unmute to check" a tab. `mutedInfo.muted` survives reloads, so a
  muted tab stays silent — the exposure is unmuted-but-paused tabs being woken.
- **Never set `autoDiscardable`.** It overrides the user's memory behaviour.
- **If a tab genuinely cannot be classified without loading it, stop and ask.**
  Name the tab and wait for approval. Never trade a reload for a tidier window.

`GET_INVENTORY` reads through `chrome.tabs.query`, so it returns `id`, `url`,
`title`, `discarded`, `audible`, and `mutedInfo` for discarded tabs **without
loading them**. This is strictly better than the DevTools page list, which may
report unloaded tabs as bare URLs with no title at all. Classify from the
inventory.

Moves are safe: `chrome.tabs.move` into an existing window operates on the
browser's tab model, not the renderer, and does not change which tab is active.

### New windows are the one activation vector

A new Chrome window must have an active tab, so whichever tab lands there first
gets activated — and if it was discarded, reloaded. To create a window without
waking anything, give it a blank `chrome://newtab/` lead tab and leave that tab
in place as the active one. Do not let a content tab become the active tab of a
newly created window. Prefer reusing a coherent existing window over creating a
new one, which avoids the problem entirely.

## Modes

### AI-driven mode — primary and default

Use this mode for at least 95% of cases, and whenever the skill is invoked
unless the user explicitly requests local analysis.

- Perform all semantic classification and organization reasoning yourself.
- Decide topic boundaries, window reuse, new window names, and every changed
  tab destination.
- Use Tab Steward only for inventory, proposal validation, preview, mutation,
  undo, and verification.
- Never click **Analyse tabs**, import the local classifier/planner, or use its
  workspaces, scores, or destinations as an AI draft — not even as a draft.

### Local fallback mode — manual backup only

The dashboard's **Analyse tabs** feature exists for a person using the extension
without an AI. Use it only when the user explicitly requests local analysis or
asks how to operate Tab Steward manually. Treat its keyword-based output as a
rough proposal requiring human review. Never switch to it merely for
convenience.

## Defaults

- Organize with windows, not native tab groups.
- Remove existing native groups within the same apply operation, and finish with
  zero native groups unless the user explicitly requests groups.
- Cap every final window at 10 tabs, counting pinned tabs, any blank lead tab,
  and the protected dashboard tab. If a topic exceeds the cap, split it into the
  narrowest coherent subtopics rather than overflowing. Exceed 10 only on
  explicit request.
- Reuse coherent existing windows before creating new ones.
- Prefer the narrowest useful topics; shared domains, vendors, or file types do
  not make tabs one topic.
- Leave pinned tabs in place.
- Detect duplicates but do not close them automatically.
- Never close a tab or window without separate explicit approval.
- Classify YouTube videos by subject rather than as one YouTube category.
- Use title and URL first; resolve anything still ambiguous out of band.
- Keep the Tab Steward dashboard in its current window during apply. Treat it as
  an operational exception and make that window **Browser Tools** when useful.

## AI-driven workflow

1. Reuse an open Tab Steward dashboard. If none is open, discover the installed
   extension and open `dashboard.html` **in a new tab or a blank `New Tab`
   page** — never by navigating a content tab. Never assume a fixed extension ID.
2. Select the dashboard and take a fresh DevTools snapshot before evaluating
   scripts in its context.
3. Request `GET_INVENTORY` with a no-argument `evaluate_script` function. Verify
   the returned `version` is 0.4.0 or newer; if it is missing or any message
   resolves to `undefined`, the loaded build is stale — ask the user to reload
   the extension and stop. Record window, tab, group, and pinned-tab counts plus
   every tab ID, membership, `discarded` flag, and `mutedInfo`.
4. Classify tabs by task or topic from title and URL. Resolve remaining
   ambiguity out of band (see Classification); never by touching the tab.
5. Build a version 1 AI proposal containing only tabs whose destination, group,
   or close state should change. Omitted tabs remain where they are. Never assign
   the dashboard tab to another window. For each new window, include a blank
   `chrome://newtab/` tab as its lead tab, or order assignments so no content tab
   is left active.
6. Send `PREVIEW_AGENT_PLAN` from a no-argument evaluated function. Store the
   returned `applyToken` in the dashboard page's `globalThis`; return its
   summary for review. Do not pass proposal JSON through `evaluate_script.args`.
7. Report the exact effects: tabs moving, windows created, source windows that
   will become empty, groups removed or created, tabs closing, duplicates,
   uncertain classifications, and any tab you could not classify without a
   reload.
8. Apply when the user explicitly requested organization. Otherwise request
   confirmation. Require separate approval for every close operation.
9. Send `APPLY_PREVIEWED_PLAN` with the unchanged cached `applyToken`. The
   extension re-reads the affected tabs and rejects the apply if their IDs,
   windows, URLs, pinned states, or groups changed after preview.
10. If apply reports a stale plan or invalid token, discard the token, re-read
    inventory, classify again, and preview a new proposal.
11. Request `GET_INVENTORY` again and verify:
    - every original tab ID remains unless closure was approved
    - tabs reached the AI-selected topic windows
    - each final window is semantically coherent and holds at most 10 tabs
    - created windows contain the expected topics
    - pinned tabs did not move
    - native group count matches the approved plan
    - no accidental empty or temporary windows remain
    - **no tab changed `mutedInfo.muted` versus the pre-apply inventory**
    - **no tab that was `discarded` before the run is now loaded**

## Classification

- Classify by actual subject and intended use, not superficial keywords.
- Distinguish broad context from the most useful working topic. For example,
  Apple documentation can belong to IOSurface research, Core Animation, or
  Apple Silicon optimization; `developer.apple.com` is not itself a topic.
- Resolve ambiguous tabs **out of band, never by loading the tab**:
  - **YouTube**: the video ID is already in the URL. Fetch
    `https://www.youtube.com/oembed?url=<watch-url>&format=json` from your own
    network stack; it returns the real title and `author_name` (the channel),
    which is usually enough. A vague title plus its channel is decisive — a
    channel known for security content places an unclear video far better than
    the title alone.
  - **Other public pages**: fetch the URL yourself rather than reading the tab.
  - **Auth-gated pages** (chat transcripts, dashboards): rely on the title,
    which is generally descriptive. Do not attempt to fetch them.
- This supersedes any older guidance to prefer inspecting the live page. Reading
  a page out of band is always preferable to waking a discarded tab.
- If a live, already-loaded tab must be inspected, confirm `discarded === false`
  in the inventory first, and read only metadata — `document.title` and
  `meta[name="description"]`. Never interact with a media player.
- Inspect PDFs whose filenames do not reveal their subjects only if they are
  already loaded. Chrome's PDF viewer exposes no DOM text, so read them from a
  screenshot, not `innerText`.
- Use a search query's research intent, not merely `google.com`.
- Prefer a few durable windows over needless one-tab windows. Keep a singleton in
  the most coherent existing window unless its subject justifies its own.
- Keep uncertain tabs in their current window unless moving them is clearly
  useful.
- Treat identical canonical URLs as duplicate candidates, never automatic
  deletions.

## Safety and recovery

- `PREVIEW_AGENT_PLAN` is read-only. Use it before every apply; the extension
  accepts only the token for its most recent internally stored canonical plan.
- Never click dashboard buttons. Apply, undo, and close use blocking confirm
  dialogs that freeze the page and every later evaluated script. The dashboard
  refreshes its own display after changes.
- Avoid opening duplicate `chrome://extensions` or dashboard tabs. Reuse one
  temporary tab for extension discovery and include its cleanup in the proposed
  closing actions.
- Keep the apply token only in the dashboard page between preview and apply. If
  the page reloads, navigates, or closes, preview again.
- Never move the dashboard tab during `APPLY_PREVIEWED_PLAN`; doing so can
  detach the DevTools target and make execution status ambiguous.
- Treat a window that becomes empty after moves as a window-closing effect and
  disclose it in the preview even though Chrome closes it implicitly.
- If a target closes or an apply result is unknown, stop and read live inventory.
  Do not retry until verification establishes the actual state.
- Tab Steward stores one pre-change undo snapshot.
- If applying fails partially, stop, re-read inventory, and offer `UNDO_LAST`.
  Do not retry blindly.
- Undo can reopen a closed URL, but cannot recover navigation history, unsaved
  form data, or in-page state.
- Do not invoke undo after later user changes without explaining the snapshot.
- Do not move or close tabs through ad hoc extension-context code when Tab
  Steward exposes the operation.

Read [references/tab-steward-api.md](references/tab-steward-api.md) before
extension discovery, inventory, proposal preview, apply, verification, recovery,
or local fallback.
