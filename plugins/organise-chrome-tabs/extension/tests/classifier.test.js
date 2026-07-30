import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyTab,
  cleanTitle,
  describeTab,
  getHostname,
} from "../lib/classifier.js";

test("classifies developer sites without a personal technology taxonomy", () => {
  const result = classifyTab({
    title: "Pull requests · openai/codex",
    url: "https://github.com/openai/codex/pulls",
  });

  assert.equal(result.workspace, "Software Development");
  assert.equal(result.group, "Code & Repositories");
  assert.equal(result.confidence, "high");
});

test("classifies YouTube videos by title topic instead of by site", () => {
  const result = classifyTab({
    title: "How a JIT Compiler Works - YouTube",
    url: "https://www.youtube.com/watch?v=abc123",
  });

  assert.equal(result.workspace, "Software Development");
  assert.equal(result.group, "Code & Repositories");
  assert.equal(result.description, "YouTube video: How a JIT Compiler Works");
});

test("uses a neutral media bucket for an unrecognized YouTube topic", () => {
  const result = classifyTab({
    title: "A quiet walk through Kyoto - YouTube",
    url: "https://youtube.com/watch?v=xyz789",
  });

  assert.equal(result.workspace, "Media & Entertainment");
  assert.equal(result.group, "Videos");
  assert.equal(result.confidence, "low");
});

test("recognizes common work, research, and shopping services", () => {
  const mail = classifyTab({
    title: "Inbox",
    url: "https://mail.google.com/mail/u/0/#inbox",
  });
  const paper = classifyTab({
    title: "Attention Is All You Need",
    url: "https://arxiv.org/abs/1706.03762",
  });
  const product = classifyTab({
    title: "USB-C dock",
    url: "https://www.amazon.com/example",
  });

  assert.equal(mail.workspace, "Work & Communication");
  assert.equal(paper.workspace, "Research & Learning");
  assert.equal(product.workspace, "Shopping & Services");
});

test("describes GitHub repositories with owner and repository", () => {
  assert.equal(
    describeTab({
      title: "ChromeDevTools/chrome-devtools-mcp: Chrome DevTools for coding agents",
      url: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    }),
    "GitHub repository: ChromeDevTools/chrome-devtools-mcp — ChromeDevTools/chrome-devtools-mcp: Chrome DevTools for coding agents",
  );
});

test("normalizes titles, hostnames, and browser pages", () => {
  assert.equal(cleanTitle("An Example — YouTube"), "An Example");
  assert.equal(getHostname("https://www.example.com/path"), "example.com");
  assert.equal(getHostname("chrome://extensions"), "chrome");
  assert.equal(
    classifyTab({
      title: "Extensions",
      url: "chrome://extensions",
    }).workspace,
    "Browser & System",
  );
});

test("uses a general domain bucket when no topic signal exists", () => {
  const result = classifyTab({
    title: "Welcome",
    url: "https://example.net/start",
  });

  assert.equal(result.workspace, "General");
  assert.equal(result.group, "example.net");
});
