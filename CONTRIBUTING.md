# Contributing

Thanks for helping improve Organise Chrome Tabs.

## Development setup

1. Fork and clone the repository.
2. Use Node.js 20 or newer.
3. Load `plugins/organise-chrome-tabs/extension` as an unpacked Chrome
   extension.
4. Run the checks:

```bash
npm test
npm run check
npm run test:ui
```

## Pull requests

- Keep browser mutations inside `background.js`.
- Preserve preview-before-apply behavior for agent-authored plans.
- Do not add host permissions or remote analytics without a clearly documented
  design discussion.
- Add tests for new classification rules, plan fields, and mutation paths.
- Keep tab/window closing opt-in and protect pinned tabs.
- Update the skill reference when the message API changes.

Use focused commits and explain the user-visible behavior in the pull request.

## Reporting bugs

Include the Chrome version, operating system, extension version, Codex or agent
version, steps to reproduce, and whether the issue occurs in local dashboard
mode, agent-assisted mode, or both. Remove private URLs and tab titles from
logs before sharing them.
