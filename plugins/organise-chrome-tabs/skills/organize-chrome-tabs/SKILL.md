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

Use Tab Steward for inventory and native tab/window operations. The AI owns all
semantic classification and destination decisions. Use Chrome DevTools only on
the Tab Steward dashboard; never use the dashboard's local **Analyse tabs**
classifier unless the user explicitly requests that manual fallback.

## Fast path

Aim to finish an ordinary organization run in about five minutes once the
connector is ready. This is a pacing target, not permission to skip verification.
Read [the API reference](references/tab-steward-api.md) once before operating.

1. **Connect once.** Require an extension-enabled Chrome DevTools connector
   (`--categoryExtensions`). Reuse one Chrome connection for discovery,
   inventory, preview, apply and verification; do not start a new connection
   for each call. Reconnect only if that connection fails or needs a setup fix.
   Reuse a known dashboard target. Otherwise use
   extension discovery described in the API reference and open the dashboard
   in a background tab. Do not inventory content with `list_pages`: it can be
   slow and omit titles. Take one dashboard snapshot.
2. **Inventory once.** Call `GET_INVENTORY`, validate `response.result.version`
   (0.4.0+), and cache the complete result on dashboard `globalThis`. Return a
   compact table of window ID/label and tab ID/title/URL/pinned/group/active/
   discarded fields. Keep favicons and repeated inventory blobs out of output.
3. **Classify in one pass.** Assign every tab a topic or an explicit stay-put
   decision from the inventory titles and URLs. Use a short uncertainty queue;
   inspect only ambiguity that would change a destination. See Classification.
4. **Choose destinations once.** Reuse coherent windows, keeping their active
   content tabs in place. Protect pinned tabs and the dashboard. Default to at
   most 10 tabs per window, including blanks and the dashboard. Split oversized
   topics into useful subtopics. Prepare any necessary windows using the blank
   lead procedure below, then build assignments only for changed tabs.
5. **Preview once, then apply.** Validate the proposal with
   `PREVIEW_AGENT_PLAN`, cache its token in the dashboard, and report moves,
   prepared/new windows, empty source windows, groups, closures, duplicates and
   uncertainty. An explicit request to organize already authorizes ordinary
   moves, labels and new windows: continue directly to `APPLY_PREVIEWED_PLAN`.
   Never ask the user to approve routine topic choices. Closing original tabs
   or windows needs separate explicit approval; avoid emptying a source window
   when closure was not authorized.
6. **Verify once and finish.** Re-read inventory and compare by native tab ID:
   preservation, expected destinations, window sizes, pinned membership, groups,
   original active tabs, and discarded states. Account for deliberate blank lead
   tabs. Label reused windows with `RENAME_WINDOW` (private dashboard labels).
   Inspect only mismatches; do not reclassify the entire browser after success.

When updating this skill after a run, record actual elapsed time, expensive
calls, failed calls and interventions separately from organizational results.
Do not claim a five-minute result or cross-model improvement without measuring
it. Fix the canonical source and refresh the installed plugin; editing a cache
or only the standalone skill leaves other invocations stale.

## Tab preservation

- Move existing tabs through Tab Steward, preserving their native tab IDs.
  Never organize by closing tabs and reopening their URLs: this can restart
  YouTube playback and autoplay many videos at once.
- Never inspect, activate, reload or navigate a content tab. Discarded tabs can
  reload and autoplay when touched. Do not use content snapshots, screenshots,
  renderer evaluations or coordinate automation. Resolve metadata out of band.
- Never mute/unmute tabs or change `autoDiscardable`.
- Leave pinned tabs and the dashboard in their original windows. Keep existing
  active content tabs in place so removing them cannot activate their neighbor.
- The inventory exposes `discarded` and `audible`; some 0.4.0 builds omit
  `mutedInfo`. Do not assert an unavailable field was verified. If audio-state
  comparison is needed, cache read-only `chrome.tabs.query({})` metadata from
  the dashboard before mutation and compare afterward.
- Remove native groups in the same apply (`removeExistingGroups: true`).
  Do not close duplicates automatically. Do not create native groups by default.

### New windows with persistent blank lead tabs

The 0.4.0 apply implementation removes its temporary placeholders. Assignment
order and `{newWindow: label}` alone do **not** keep content inactive.

After choosing the final topics, report the number of windows to prepare. Call
Tab Steward `CREATE_WINDOW` for each necessary label and retain the returned
window ID and its original blank active tab. These calls create focused blank
windows; report this if relevant. Build the reviewed proposal using these
**existing** window IDs. Omit their blank tabs from assignments. Apply's own
placeholders will be removed, but the pre-created blanks remain active. Include
these intentional blanks in counts and verification. They are not cleanup
failures. Creating windows before preview means the apply undo snapshot includes
these windows; do not claim undo will remove them.

Do not move an active content tab or empty a source window merely to improve
sorting. Keep it as a disclosed exception if the rest can be usefully organized.

## Classification

Classify by subject and intended use, not domain or file type. YouTube is not a
topic. A Claude conversation about kernel memory belongs with operating systems;
a Google search belongs with its research intent. Choose narrow useful topics
without creating unnecessary one-tab windows.

Inventory titles usually resolve apparent ambiguity in a DevTools page list.
For remaining public YouTube uncertainty, fetch oEmbed title and channel from
`https://www.youtube.com/oembed?url=<encoded-watch-url>&format=json` outside
Chrome. Batch independent requests with bounded concurrency and a short timeout
(e.g. 8 seconds); deduplicate requests by video ID. Do not fetch every video.
For other public pages/PDFs, use an out-of-browser fetch only if needed. Do not
fetch private conversations or authenticated dashboards.

If the evidence remains weak, keep the tab in its current window and report the
uncertainty. Do not stop the whole run to ask about a single vague title or keep
retrying metadata requests. Ask only if the missing information blocks the
requested outcome. Treat equal canonical URLs as duplicate candidates; preserve
meaningful URL differences and distinguish video timestamp variants.

## Failure handling

- Missing extension capability is a connector setup problem, not a stale Tab
  Steward build. Use an available extension-enabled connector or explain the
  required setup; do not retry blocked URLs or route through unrelated apps.
- Missing runtime version or `undefined` API response: follow the API reference's
  reload requirement. Do not guess a message protocol.
- Stale preview rejected before mutation: refresh inventory, update only changed
  rows, and preview again. If staleness repeats, leave volatile tabs in place
  and finish the stable subset when useful; disclose what was deferred.
- Unknown/partial apply result: read inventory before doing anything else.
  Never retry blindly. Offer `UNDO_LAST` only after checking the live state and
  explaining that it restores one snapshot, not navigation/form history.
- Never click dashboard mutation buttons: they can open blocking dialogs. Keep
  the token on dashboard `globalThis`; navigation/reload requires a new preview.
