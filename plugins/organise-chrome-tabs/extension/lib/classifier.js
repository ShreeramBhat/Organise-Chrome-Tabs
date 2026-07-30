export const WORKSPACE_COLORS = {
  "AI & Automation": "purple",
  "Software Development": "cyan",
  "Work & Communication": "blue",
  "Research & Learning": "orange",
  "News & Reading": "yellow",
  "Media & Entertainment": "pink",
  "Social & Communities": "red",
  "Finance & Business": "green",
  "Shopping & Services": "yellow",
  "Travel & Maps": "blue",
  "Browser & System": "grey",
  General: "grey",
};

const RULES = [
  {
    workspace: "AI & Automation",
    group: "AI Tools",
    domains: [
      "chatgpt.com",
      "openai.com",
      "claude.ai",
      "anthropic.com",
      "gemini.google.com",
      "perplexity.ai",
    ],
    keywords: [
      "artificial intelligence",
      "machine learning",
      "large language model",
      "chatgpt",
      "claude",
      "gemini",
      "copilot",
      "codex",
      "llm",
      "prompt engineering",
    ],
  },
  {
    workspace: "AI & Automation",
    group: "Automation & Agents",
    domains: [],
    keywords: [
      "model context protocol",
      "mcp server",
      "browser automation",
      "playwright",
      "puppeteer",
      "chrome devtools",
      "ai agent",
      "workflow automation",
    ],
  },
  {
    workspace: "Software Development",
    group: "Code & Repositories",
    domains: [
      "github.com",
      "gitlab.com",
      "bitbucket.org",
      "stackoverflow.com",
    ],
    keywords: [
      "source code",
      "repository",
      "pull request",
      "compiler",
      "runtime",
      "programming",
      "developer documentation",
      "api reference",
    ],
  },
  {
    workspace: "Software Development",
    group: "Web Development",
    domains: [
      "npmjs.com",
      "developer.mozilla.org",
      "vercel.com",
      "netlify.com",
    ],
    keywords: [
      "javascript",
      "typescript",
      "react",
      "vue",
      "svelte",
      "next.js",
      "node.js",
      "frontend",
      "backend",
      "web development",
      "css",
      "html",
    ],
  },
  {
    workspace: "Work & Communication",
    group: "Mail & Messaging",
    domains: [
      "mail.google.com",
      "outlook.live.com",
      "outlook.office.com",
      "slack.com",
      "discord.com",
      "teams.microsoft.com",
      "web.whatsapp.com",
    ],
    keywords: ["inbox", "webmail", "team chat", "messages"],
  },
  {
    workspace: "Work & Communication",
    group: "Documents & Planning",
    domains: [
      "docs.google.com",
      "notion.so",
      "linear.app",
      "trello.com",
      "asana.com",
      "figma.com",
      "miro.com",
    ],
    keywords: [
      "project plan",
      "meeting notes",
      "roadmap",
      "task board",
      "spreadsheet",
      "presentation",
    ],
  },
  {
    workspace: "Research & Learning",
    group: "Reference & Learning",
    domains: [
      "wikipedia.org",
      "arxiv.org",
      "coursera.org",
      "edx.org",
      "khanacademy.org",
      "scholar.google.com",
    ],
    keywords: [
      "research paper",
      "tutorial",
      "course",
      "lecture",
      "documentation",
      "how to",
      "explained",
      "guide",
    ],
  },
  {
    workspace: "News & Reading",
    group: "News & Articles",
    domains: [
      "medium.com",
      "substack.com",
      "news.ycombinator.com",
      "bbc.com",
      "reuters.com",
    ],
    keywords: ["breaking news", "newsletter", "opinion", "analysis", "article"],
  },
  {
    workspace: "Finance & Business",
    group: "Markets & Business",
    domains: [
      "finance.yahoo.com",
      "bloomberg.com",
      "marketwatch.com",
      "tradingview.com",
    ],
    keywords: [
      "stock market",
      "earnings",
      "investing",
      "portfolio",
      "cryptocurrency",
      "business",
      "economy",
    ],
  },
  {
    workspace: "Shopping & Services",
    group: "Shopping",
    domains: [
      "amazon.com",
      "amazon.in",
      "flipkart.com",
      "ebay.com",
      "etsy.com",
    ],
    keywords: ["shopping", "checkout", "shopping cart", "product details"],
  },
  {
    workspace: "Travel & Maps",
    group: "Travel",
    domains: [
      "maps.google.com",
      "booking.com",
      "airbnb.com",
      "tripadvisor.com",
      "expedia.com",
    ],
    keywords: ["flight", "hotel", "travel", "directions", "itinerary"],
  },
  {
    workspace: "Social & Communities",
    group: "Social",
    domains: [
      "reddit.com",
      "linkedin.com",
      "x.com",
      "twitter.com",
      "facebook.com",
      "instagram.com",
      "mastodon.social",
    ],
    keywords: ["social network", "community discussion"],
  },
  {
    workspace: "Browser & System",
    group: "Browser Tools",
    schemes: ["chrome:", "chrome-extension:"],
    domains: [],
    keywords: [],
  },
];

const DOMAIN_LABELS = {
  "youtube.com": "YouTube",
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "stackoverflow.com": "Stack Overflow",
  "wikipedia.org": "Wikipedia",
  "reddit.com": "Reddit",
  "linkedin.com": "LinkedIn",
  "google.com": "Google",
};

function normalize(value = "") {
  return ` ${value
    .toLowerCase()
    .replace(/[_–—|]+/g, " ")
    .replace(/\s+/g, " ")} `;
}

export function getHostname(url = "") {
  if (url.startsWith("chrome://")) return "chrome";
  if (url.startsWith("chrome-extension://")) return "chrome-extension";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function baseDomain(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function matchesDomain(hostname, expected) {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

export function cleanTitle(title = "") {
  return title
    .replace(/\s*[-–—|]\s*YouTube\s*$/i, "")
    .replace(/\s*[-–—|]\s*GitHub\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function describeTab(tab) {
  const title = cleanTitle(tab.title || "Untitled");
  const hostname = getHostname(tab.url);

  if (matchesDomain(hostname, "youtube.com")) {
    return `YouTube video: ${title}`;
  }

  if (hostname === "github.com" || hostname === "gitlab.com") {
    try {
      const path = new URL(tab.url).pathname.split("/").filter(Boolean);
      if (path.length >= 2) {
        return `${DOMAIN_LABELS[hostname]} repository: ${path[0]}/${path[1]} — ${title}`;
      }
    } catch {
      // Fall through to the generic description.
    }
  }

  if (hostname === "chrome" || hostname === "chrome-extension") {
    return `Browser page: ${title}`;
  }

  const domain = DOMAIN_LABELS[baseDomain(hostname)] || hostname || "Local page";
  return `${domain}: ${title}`;
}

function scoreRule(rule, tab, hostname, haystack) {
  let score = 0;
  const reasons = [];

  if (
    rule.schemes?.some((scheme) => String(tab.url || "").startsWith(scheme))
  ) {
    score += 10;
    reasons.push("browser URL");
  }

  const domain = rule.domains?.find((candidate) =>
    matchesDomain(hostname, candidate),
  );
  if (domain) {
    score += 6;
    reasons.push(domain);
  }

  for (const keyword of rule.keywords || []) {
    if (!haystack.includes(` ${keyword.toLowerCase()} `) &&
        !haystack.includes(keyword.toLowerCase())) {
      continue;
    }
    score += Math.max(1, Math.min(4, keyword.length / 6));
    reasons.push(keyword);
  }

  return { score, reasons };
}

export function classifyTab(tab) {
  const hostname = getHostname(tab.url);
  const haystack = normalize(`${tab.title || ""} ${tab.url || ""} ${hostname}`);
  let best = null;

  for (const rule of RULES) {
    const result = scoreRule(rule, tab, hostname, haystack);
    if (result.score > 0 && (!best || result.score > best.score)) {
      best = { ...rule, ...result };
    }
  }

  if (best) {
    return {
      workspace: best.workspace,
      group: best.group,
      description: describeTab(tab),
      confidence: best.score >= 6 ? "high" : best.score >= 3 ? "medium" : "low",
      reason: best.reasons.slice(0, 3).join(", "),
    };
  }

  if (matchesDomain(hostname, "youtube.com")) {
    return {
      workspace: "Media & Entertainment",
      group: "Videos",
      description: describeTab(tab),
      confidence: "low",
      reason: "YouTube title needs topic review",
    };
  }

  const domain = baseDomain(hostname);
  const label = DOMAIN_LABELS[domain] || domain || "Other";
  return {
    workspace: "General",
    group: label,
    description: describeTab(tab),
    confidence: "low",
    reason: domain ? `Grouped by ${domain}` : "No recognizable topic",
  };
}

export function colorForWorkspace(workspace) {
  return WORKSPACE_COLORS[workspace] || "grey";
}

export function listWorkspaces() {
  return Object.keys(WORKSPACE_COLORS);
}
