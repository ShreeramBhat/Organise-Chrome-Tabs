# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a
vulnerability** feature for this repository. Do not open a public issue for a
vulnerability that could expose browsing data or modify a user's Chrome
session.

Include a minimal reproduction, affected version, impact, and any suggested
mitigation. Remove unrelated private browsing data from screenshots and logs.

## Security boundaries

- The extension requests `tabs`, `tabGroups`, and `storage`; it requests no host
  permissions.
- Runtime automation messages are used from the extension dashboard context.
- Browser mutations are validated in the extension service worker.
- Agent-assisted mode can expose inspected browser content to the configured
  agent and model provider.
- Chrome DevTools MCP has broad access to the connected browser profile. Use a
  profile appropriate for the agent and review Chrome's connection prompt.
