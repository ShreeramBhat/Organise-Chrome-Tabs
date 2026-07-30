import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromeBinary = chromeCandidates.find((candidate) =>
  existsSync(candidate),
);

if (!existsSync(chromeBinary)) {
  console.log("UI smoke test skipped: Google Chrome is not installed.");
  process.exit(0);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  const requested = decodeURIComponent(
    new URL(request.url, "http://localhost").pathname,
  );
  const relative = requested === "/" ? "dashboard.html" : requested.slice(1);
  const filePath = normalize(join(projectRoot, relative));
  if (
    !filePath.startsWith(projectRoot) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const serverAddress = server.address();
const pageUrl = `http://127.0.0.1:${serverAddress.port}/dashboard.html`;
const profilePath = mkdtempSync(join(tmpdir(), "tab-steward-ui-"));
const debuggingPort = 9341;

const chromeProcess = spawn(
  chromeBinary,
  [
    `--user-data-dir=${profilePath}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    ...(typeof process.getuid === "function" && process.getuid() === 0
      ? ["--no-sandbox"]
      : []),
    `--remote-debugging-port=${debuggingPort}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitForTargets() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${debuggingPort}/json/list`,
      );
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome did not expose its test target.");
}

function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 0;
  const pending = new Map();
  const events = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else {
      events.push(message);
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    call(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    events,
    close() {
      socket.close();
    },
  };
}

const inventory = {
  capturedAt: Date.now(),
  windows: [
    {
      id: 10,
      focused: true,
      incognito: false,
      state: "normal",
      type: "normal",
      label: "Development",
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          groupId: -1,
          title: "Metal Overview | Apple Developer",
          url: "https://developer.apple.com/metal/",
          favIconUrl: "",
          group: null,
        },
        {
          id: 2,
          windowId: 10,
          index: 1,
          active: false,
          pinned: false,
          groupId: -1,
          title: "How a JIT Compiler Works - YouTube",
          url: "https://youtube.com/watch?v=jit",
          favIconUrl: "",
          group: null,
        },
      ],
    },
    {
      id: 20,
      focused: false,
      incognito: false,
      state: "normal",
      type: "normal",
      label: "",
      tabs: [
        {
          id: 3,
          windowId: 20,
          index: 0,
          active: true,
          pinned: false,
          groupId: -1,
          title: "Claude Code tips - YouTube",
          url: "https://youtube.com/watch?v=claude",
          favIconUrl: "",
          group: null,
        },
      ],
    },
  ],
};

const mockSource = `
  globalThis.chrome = {
    runtime: {
      getURL(path) { return "chrome-extension://test-extension/" + path; },
      async sendMessage(message) {
        if (message.type === "GET_INVENTORY") {
          return { ok: true, result: ${JSON.stringify(inventory)} };
        }
        if (message.type === "GET_UNDO_STATE") {
          return { ok: true, result: { available: false } };
        }
        return { ok: false, error: "Unexpected UI smoke-test message: " + message.type };
      }
    }
  };
`;

let client;
try {
  const targets = await waitForTargets();
  const page = targets.find((target) => target.type === "page");
  assert.ok(page, "Chrome created a page target.");
  client = cdpClient(page.webSocketDebuggerUrl);
  await client.ready;
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: mockSource,
  });
  await client.call("Page.navigate", { url: pageUrl });
  await new Promise((resolve) => setTimeout(resolve, 800));

  const initial = await client.call("Runtime.evaluate", {
    expression: `({
      ready: document.readyState,
      title: document.title,
      heading: document.querySelector("h1")?.textContent,
      windowCards: document.querySelectorAll(".window-card").length,
      tabStat: [...document.querySelectorAll("#browserStats .stat")]
        .map((node) => node.textContent.trim())
        .join(" ")
    })`,
    returnByValue: true,
  });
  const initialValue = initial.result.result.value;
  assert.equal(initialValue.ready, "complete");
  assert.equal(initialValue.title, "Tab Steward");
  assert.equal(initialValue.heading, "Tab Steward");
  assert.equal(initialValue.windowCards, 2);
  assert.match(initialValue.tabStat, /3\s+tabs/);

  await client.call("Runtime.evaluate", {
    expression: `document.querySelector("#analyzeButton").click()`,
  });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const analyzed = await client.call("Runtime.evaluate", {
    expression: `({
      planVisible: !document.querySelector("#planSection").classList.contains("hidden"),
      planRows: document.querySelectorAll("#planRows tr").length,
      descriptions: [...document.querySelectorAll("#planRows .description")]
        .map((node) => node.textContent)
    })`,
    returnByValue: true,
  });
  const analyzedValue = analyzed.result.result.value;
  assert.equal(analyzedValue.planVisible, true);
  assert.equal(analyzedValue.planRows, 3);
  assert.ok(
    analyzedValue.descriptions.some((description) =>
      description.includes("YouTube video: How a JIT Compiler Works"),
    ),
  );

  const exceptions = client.events.filter(
    (event) => event.method === "Runtime.exceptionThrown",
  );
  assert.equal(exceptions.length, 0);
  console.log(
    "UI smoke test passed: dashboard rendered 2 windows and analysed 3 tabs.",
  );
} finally {
  client?.close();
  const chromeExited = new Promise((resolve) => {
    if (chromeProcess.exitCode !== null) resolve();
    else chromeProcess.once("exit", resolve);
  });
  chromeProcess.kill("SIGTERM");
  await Promise.race([
    chromeExited,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  await new Promise((resolve) => server.close(resolve));
  if (
    profilePath.startsWith(tmpdir()) &&
    profilePath.includes("tab-steward-ui-")
  ) {
    rmSync(profilePath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}
