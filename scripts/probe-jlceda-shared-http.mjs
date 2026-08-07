import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const nodePath = path.join(codexHome, "tools", "node-v24.18.1-win-x64", "node.exe");
const packageRoot = path.join(codexHome, "tools", "easyeda-mcp-pro", "node_modules", "easyeda-mcp-pro");
const entryPath = path.join(packageRoot, "dist", "index.js");
const packagePath = path.join(packageRoot, "package.json");
const outputPath = path.join(root, "build", "jlceda-shared-http-isolated-probe.json");
const bridgePort = 49640;
const httpPort = 49641;
const checks = [];
const startedAt = new Date().toISOString();
let child;
let stderr = "";

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

async function waitForJson(url, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function parseSseJson(text) {
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`MCP response has no SSE data line: ${text.slice(0, 200)}`);
  return JSON.parse(dataLine.slice("data: ".length));
}

async function mcpPost(body, sessionId = null) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return {
    sessionId: response.headers.get("mcp-session-id") || sessionId,
    document: text.trim() ? parseSseJson(text) : null,
  };
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

let packageDocument;
let health = null;
let ready = null;
let initialize = null;
let bridgeStatus = null;
let fatalError = null;

try {
  packageDocument = JSON.parse(await readFile(packagePath, "utf8"));
  check("pinned package version", packageDocument.version === "0.35.4", packageDocument.version);
  check("isolated bridge port free", await portIsFree(bridgePort), `127.0.0.1:${bridgePort}`);
  check("isolated HTTP port free", await portIsFree(httpPort), `127.0.0.1:${httpPort}`);
  if (checks.some((item) => !item.passed)) throw new Error("isolated probe ports or package version preflight failed");

  child = spawn(nodePath, [entryPath], {
    cwd: packageRoot,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      TRANSPORT: "http",
      HTTP_HOST: "127.0.0.1",
      HTTP_PORT: String(httpPort),
      HTTP_AUTH_DISABLED: "true",
      BRIDGE_HOST: "127.0.0.1",
      BRIDGE_PORT: String(bridgePort),
      BRIDGE_PORT_SCAN: String(bridgePort),
      TOOL_PROFILE: "core",
      TOOL_SCOPES: "diagnostics:read,schematic:read,bom:read,checks:read,pcb:read",
      BRIDGE_RAW_EXEC_ENABLED: "false",
      MCP_RAW_EXEC_EXPERIMENTAL: "false",
      JLCPCB_ENABLE_ORDERING: "false",
      JLCPCB_MODE: "disabled",
      JLCSEARCH_ENABLED: "false",
      KEYLESS_SOURCING_ENABLED: "false",
      MCP_BRIDGE_BACKEND: "local_bridge",
    },
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  health = await waitForJson(`http://127.0.0.1:${httpPort}/healthz`);
  ready = await waitForJson(`http://127.0.0.1:${httpPort}/readyz`);
  check("HTTP health", health.status === "ok" && health.version === "0.35.4", health);
  check("HTTP readiness", ready.status === "ok", ready);

  const initialized = await mcpPost({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "yimi-jlceda-isolated-probe", version: "1" },
    },
  });
  initialize = initialized.document;
  check("MCP session allocated", typeof initialized.sessionId === "string" && initialized.sessionId.length > 0,
    initialized.sessionId ? "allocated" : "missing");
  check("MCP initialize", initialize?.result?.serverInfo?.version === "0.35.4", initialize?.result?.serverInfo ?? null);

  await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, initialized.sessionId);
  const called = await mcpPost({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "easyeda_bridge_status", arguments: {} },
  }, initialized.sessionId);
  bridgeStatus = called.document?.result?.structuredContent ?? null;
  check("isolated bridge status tool", bridgeStatus?.diagnostics?.active_port === bridgePort, bridgeStatus);
  check("isolated probe does not claim EDA connection", bridgeStatus?.connected === false,
    "No extension is routed to the isolated bridge port; connected must remain false.");
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error);
} finally {
  await stopChild();
}

check("probe process stopped", child ? (child.exitCode !== null || child.signalCode !== null) : true,
  child ? { exitCode: child.exitCode, signalCode: child.signalCode } : null);
if (fatalError) check("probe completed", false, fatalError);

const report = {
  schemaVersion: 1,
  reportKind: "jlceda-shared-http-isolated-probe",
  startedAt,
  completedAt: new Date().toISOString(),
  package: {
    name: packageDocument?.name ?? null,
    version: packageDocument?.version ?? null,
    entrySha256: createHash("sha256").update(await readFile(entryPath)).digest("hex"),
  },
  topology: {
    transport: "http",
    httpHost: "127.0.0.1",
    httpPort,
    bridgeHost: "127.0.0.1",
    bridgePort,
    bridgePortScan: String(bridgePort),
    scope: "ISOLATED_NO_EDA_EXTENSION",
  },
  health,
  ready,
  initializeServerInfo: initialize?.result?.serverInfo ?? null,
  bridgeStatus,
  stderrSha256: createHash("sha256").update(stderr).digest("hex"),
  checks,
  passed: checks.every((item) => item.passed),
  interpretation: "This probe validates one loopback HTTP MCP session and a shared BridgeManager process on isolated ports. It does not validate a real EasyEDA connection, two Codex clients, concurrency, reconnect, desktop config refresh, or migration rollback.",
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`JLCEDA shared HTTP isolated probe: ${report.passed ? "PASS" : "FAIL"}`);
console.log(`HTTP ${httpPort}; bridge ${bridgePort}; package ${report.package.version}`);
console.log(`Report: ${path.relative(root, outputPath)}`);
if (!report.passed) process.exitCode = 1;
