import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const profilePath = path.join(root, "hardware", "evt0", "eda-shared-http-poc-v1", "profile.json");
const outputPath = path.join(root, "build", "jlceda-shared-http-poc.json");
const startedAt = new Date().toISOString();
const runKey = `${startedAt.replaceAll(":", "-")}-${process.pid}`;
const checks = [];
const cycles = [];
let fatalError = null;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function addCheck(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail });
}

async function fileEvidence(file) {
  const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
  return { bytes: info.size, sha256: sha256(bytes) };
}

async function treeEvidence(directory) {
  const entries = [];
  const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  async function visit(current, relativePrefix = "") {
    const dirents = await readdir(current, { withFileTypes: true });
    dirents.sort((left, right) => compareText(left.name, right.name));
    for (const dirent of dirents) {
      const absolute = path.join(current, dirent.name);
      const relative = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) throw new Error(`runtime tree contains unsupported symbolic link: ${relative}`);
      if (dirent.isDirectory()) await visit(absolute, relative);
      else if (dirent.isFile()) {
        const bytes = await readFile(absolute);
        entries.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit(directory);
  entries.sort((left, right) => compareText(left.path, right.path));
  const manifest = entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join("");
  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    sha256: sha256(manifest),
  };
}

async function captureProtected(profile) {
  const result = {};
  for (const item of profile.protectedState) {
    const base = item.pathKind === "CODEX_HOME" ? codexHome : root;
    const absolute = path.join(base, ...item.path.split("/"));
    result[item.id] = { pathKind: item.pathKind, path: item.path, ...await fileEvidence(absolute) };
  }
  return result;
}

async function portIsFree(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => server.close(() => resolve(true)));
  });
}

async function tcpSnapshot() {
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i);
    if (!match) continue;
    rows.push({ local: match[1], remote: match[2], state: match[3].toUpperCase(), pid: Number(match[4]) });
  }
  return rows;
}

function endpointPort(endpoint) {
  const match = endpoint.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function listenersAt(rows, port) {
  return rows
    .filter((row) => row.state === "LISTENING" && endpointPort(row.local) === port)
    .sort((left, right) => left.pid - right.pid || left.local.localeCompare(right.local));
}

function endpointsAt(rows, port) {
  return rows
    .filter((row) => endpointPort(row.local) === port || endpointPort(row.remote) === port)
    .sort((left, right) => left.pid - right.pid || left.local.localeCompare(right.local) || left.remote.localeCompare(right.remote));
}

function minimalChildEnvironment() {
  const allowed = [
    "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "PATH", "TEMP", "TMP",
    "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
    "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "TZ",
  ];
  return Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function parseMcpDocument(text, contentType) {
  if (!text.trim()) return null;
  if (contentType.includes("text/event-stream")) {
    const documents = text.split(/\r?\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length)));
    if (documents.length === 0) throw new Error(`MCP SSE response has no data event: ${text.slice(0, 200)}`);
    return documents.at(-1);
  }
  return JSON.parse(text);
}

function createClient(httpHost, httpPort) {
  const endpoint = `http://${httpHost}:${httpPort}/mcp`;
  return async function request({ body = null, sessionId = null, method = "POST", expectedStatus = null }) {
    const headers = { accept: "application/json, text/event-stream" };
    if (body !== null) headers["content-type"] = "application/json";
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(endpoint, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    if (expectedStatus !== null) {
      if (response.status !== expectedStatus) {
        throw new Error(`${method} ${endpoint} expected HTTP ${expectedStatus}, got ${response.status}: ${text.slice(0, 200)}`);
      }
    } else if (!response.ok) {
      throw new Error(`${method} ${endpoint} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return {
      status: response.status,
      sessionId: response.headers.get("mcp-session-id") || sessionId,
      document: text.trim() ? parseMcpDocument(text, response.headers.get("content-type") || "") : null,
    };
  };
}

async function waitForJson(url, attempts = 60) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

async function waitForPortsFree(host, ports, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const states = await Promise.all(ports.map((port) => portIsFree(host, port)));
    if (states.every(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function initializeSession(request, name, requestId) {
  const initialized = await request({
    body: {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name, version: "1" },
      },
    },
  });
  if (!initialized.sessionId) throw new Error(`${name} did not receive MCP-Session-Id`);
  await request({
    sessionId: initialized.sessionId,
    body: { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  });
  return {
    id: initialized.sessionId,
    idHash: sha256(initialized.sessionId),
    serverInfo: initialized.document?.result?.serverInfo ?? null,
  };
}

async function listTools(request, sessionId, requestId) {
  const response = await request({
    sessionId,
    body: { jsonrpc: "2.0", id: requestId, method: "tools/list", params: {} },
  });
  const names = (response.document?.result?.tools ?? []).map((tool) => tool.name).sort();
  return {
    count: names.length,
    nameSetSha256: sha256(names.join("\n")),
    hasBridgeStatus: names.includes("easyeda_bridge_status"),
    hasWriteScopeProbe: names.includes("easyeda_schematic_place_component"),
    hasRawExecute: names.includes("easyeda_execute"),
  };
}

async function bridgeStatus(request, sessionId, requestId) {
  const response = await request({
    sessionId,
    body: {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: { name: "easyeda_bridge_status", arguments: {} },
    },
  });
  const value = response.document?.result?.structuredContent ?? {};
  return {
    connected: value.connected ?? null,
    activePort: value.diagnostics?.active_port ?? null,
    bridgeHost: value.diagnostics?.host ?? null,
  };
}

async function callTool(request, sessionId, requestId, name, args = {}) {
  const response = await request({
    sessionId,
    body: { jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } },
  });
  return response.document?.result ?? null;
}

async function closeSession(request, sessionId) {
  const response = await request({ method: "DELETE", sessionId });
  return response.status;
}

async function waitForUnknownSession(request, sessionId, requestId, attempts = 10) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request({
        sessionId,
        body: { jsonrpc: "2.0", id: requestId, method: "tools/list", params: {} },
        expectedStatus: 404,
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null, forced: false };
  }
  const waitForExit = async (timeoutMs) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return { exitCode: child.exitCode, signalCode: child.signalCode };
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        child.off("error", onError);
        resolve(null);
      }, timeoutMs);
      const onExit = (exitCode, signalCode) => {
        clearTimeout(timer);
        child.off("error", onError);
        resolve({ exitCode, signalCode });
      };
      const onError = (error) => {
        clearTimeout(timer);
        child.off("exit", onExit);
        reject(error);
      };
      child.once("exit", onExit);
      child.once("error", onError);
    });
  };
  const termSent = child.kill("SIGTERM");
  if (!termSent && child.exitCode === null && child.signalCode === null) {
    throw new Error(`failed to send SIGTERM to child PID ${child.pid}`);
  }
  const outcome = await waitForExit(5000);
  if (outcome) return { ...outcome, forced: false };
  const killSent = child.kill("SIGKILL");
  if (!killSent && child.exitCode === null && child.signalCode === null) {
    throw new Error(`failed to send SIGKILL to child PID ${child.pid}`);
  }
  const forcedOutcome = await waitForExit(5000);
  if (!forcedOutcome) throw new Error(`child PID ${child.pid} did not exit after SIGKILL timeout`);
  return { ...forcedOutcome, forced: true };
}

async function startCycle(profile, nodePath, entryPath, cycleNumber) {
  const topology = profile.isolatedTopology;
  const runtimeRoot = path.resolve(root, profile.isolatedRuntimeStorage.root, runKey, `cycle-${cycleNumber}`);
  const allowedRuntimeRoot = path.resolve(root, "build", "jlceda-shared-http-poc-runtime");
  const relativeRuntime = path.relative(allowedRuntimeRoot, runtimeRoot);
  if (relativeRuntime.startsWith("..") || path.isAbsolute(relativeRuntime)) {
    throw new Error(`isolated runtime escaped its allowed root: ${runtimeRoot}`);
  }
  await mkdir(path.join(runtimeRoot, "artifacts"), { recursive: true });
  await mkdir(path.join(runtimeRoot, "cache"), { recursive: true });
  let stdout = "";
  let stderr = "";
  const child = spawn(nodePath, [entryPath], {
    cwd: path.dirname(path.dirname(entryPath)),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...minimalChildEnvironment(),
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      TRANSPORT: "http",
      HTTP_HOST: topology.httpHost,
      HTTP_PORT: String(topology.httpPort),
      HTTP_AUTH_DISABLED: "true",
      OAUTH_ENABLED: "false",
      HTTP_RATE_LIMIT_MAX: "100",
      BRIDGE_HOST: topology.bridgeHost,
      BRIDGE_PORT: String(topology.bridgePort),
      BRIDGE_PORT_SCAN: topology.bridgePortScan,
      TOOL_PROFILE: topology.toolProfile,
      TOOL_SCOPES: topology.toolScopes.join(","),
      BRIDGE_RAW_EXEC_ENABLED: "false",
      MCP_RAW_EXEC_EXPERIMENTAL: "false",
      JLCPCB_ENABLE_ORDERING: "false",
      JLCPCB_MODE: "disabled",
      JLCSEARCH_ENABLED: "false",
      KEYLESS_SOURCING_ENABLED: "false",
      MOUSER_ENABLED: "false",
      DIGIKEY_ENABLED: "false",
      MCP_BRIDGE_BACKEND: "local_bridge",
      DATA_DIR: runtimeRoot,
      SQLITE_PATH: path.join(runtimeRoot, "easyeda-mcp-pro.sqlite"),
      ARTIFACT_DIR: path.join(runtimeRoot, "artifacts"),
      CACHE_DIR: path.join(runtimeRoot, "cache"),
    },
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const spawnError = new Promise((_, reject) => child.once("error", reject));

  try {
    const request = createClient(topology.httpHost, topology.httpPort);
    const health = await Promise.race([
      waitForJson(`http://${topology.httpHost}:${topology.httpPort}/healthz`),
      spawnError,
    ]);
    const ready = await waitForJson(`http://${topology.httpHost}:${topology.httpPort}/readyz`);
    const network = await tcpSnapshot();
    const bridgeListeners = listenersAt(network, topology.bridgePort);
    const httpListeners = listenersAt(network, topology.httpPort);
    const allChildListeners = network
      .filter((row) => row.state === "LISTENING" && row.pid === child.pid)
      .sort((left, right) => left.local.localeCompare(right.local));
    const listenerSummary = { bridge: bridgeListeners, http: httpListeners };
    const sqlitePath = path.join(runtimeRoot, "easyeda-mcp-pro.sqlite");
    const [sqliteInfo, artifactsInfo, cacheInfo] = await Promise.all([
      stat(sqlitePath),
      stat(path.join(runtimeRoot, "artifacts")),
      stat(path.join(runtimeRoot, "cache")),
    ]);
    const runtimeStorage = {
      root: path.relative(root, runtimeRoot).replaceAll("\\", "/"),
      sqlite: path.relative(root, sqlitePath).replaceAll("\\", "/"),
      sqliteBytes: sqliteInfo.size,
      artifactsDirectory: artifactsInfo.isDirectory(),
      cacheDirectory: cacheInfo.isDirectory(),
    };

    return {
      cycleNumber,
      child,
      request,
      health,
      ready,
      runtimeRoot: path.relative(root, runtimeRoot).replaceAll("\\", "/"),
      listenerSummary,
      allChildListeners,
      runtimeStorage,
      logs: () => ({
        stdoutBytes: Buffer.byteLength(stdout),
        stdoutSha256: sha256(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stderrSha256: sha256(stderr),
      }),
    };
  } catch (error) {
    await stopChild(child).catch(() => undefined);
    throw error;
  }
}

let profile;
let profileBytes;
let nodePath;
let packageRoot;
let entryPath;
let toolRoot;
let protectedBefore = null;
let protectedAfter = null;
let live49620Before = [];
let live49620After = [];
let live49620EndpointsBefore = [];
let live49620EndpointsAfter = [];
let cycle1 = null;
let cycle2 = null;
let oldSessionForRestart = null;

try {
  profileBytes = await readFile(profilePath);
  profile = JSON.parse(profileBytes.toString("utf8"));
  addCheck("PROFILE_IDENTITY", profile.schemaVersion === 1 && profile.profileId === "HW-EDA-SHARED-HTTP-POC-V1", profile.profileId);

  nodePath = path.join(codexHome, ...profile.runtime.nodeRelativeToCodexHome.split("/"));
  toolRoot = path.join(codexHome, ...profile.runtime.toolRootRelativeToCodexHome.split("/"));
  packageRoot = path.join(codexHome, ...profile.runtime.packageRelativeToCodexHome.split("/"));
  entryPath = path.join(packageRoot, "dist", "index.js");
  const [nodeEvidence, packageDocument] = await Promise.all([
    fileEvidence(nodePath),
    readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
  ]);
  const { stdout: nodeVersionStdout } = await execFileAsync(nodePath, ["--version"], { windowsHide: true });
  const runtimeOk = nodeVersionStdout.trim() === profile.runtime.nodeVersion &&
    nodeEvidence.bytes === profile.runtime.nodeBytes && nodeEvidence.sha256 === profile.runtime.nodeSha256 &&
    packageDocument.name === profile.runtime.packageName && packageDocument.version === profile.runtime.packageVersion;
  addCheck("PINNED_RUNTIME", runtimeOk, {
    nodeVersion: nodeVersionStdout.trim(), nodeBytes: nodeEvidence.bytes, nodeSha256: nodeEvidence.sha256,
    packageName: packageDocument.name, packageVersion: packageDocument.version,
  });

  const packageEvidence = [];
  for (const expected of profile.runtime.evidenceFiles) {
    const actual = await fileEvidence(path.join(packageRoot, ...expected.path.split("/")));
    packageEvidence.push({ path: expected.path, ...actual, matched: actual.bytes === expected.bytes && actual.sha256 === expected.sha256 });
  }
  const [packageTree, toolPackageLock] = await Promise.all([
    treeEvidence(packageRoot),
    fileEvidence(path.join(toolRoot, profile.runtime.toolPackageLock.path)),
  ]);
  const packageTreeMatches = packageTree.fileCount === profile.runtime.packageTree.fileCount &&
    packageTree.totalBytes === profile.runtime.packageTree.totalBytes && packageTree.sha256 === profile.runtime.packageTree.sha256;
  const toolLockMatches = toolPackageLock.bytes === profile.runtime.toolPackageLock.bytes &&
    toolPackageLock.sha256 === profile.runtime.toolPackageLock.sha256;
  addCheck("PINNED_PACKAGE_EVIDENCE", packageEvidence.every((item) => item.matched) && packageTreeMatches && toolLockMatches,
    { files: packageEvidence, packageTree: { ...packageTree, matched: packageTreeMatches }, toolPackageLock: { ...toolPackageLock, matched: toolLockMatches } });

  protectedBefore = await captureProtected(profile);
  addCheck("PROTECTED_STATE_CAPTURED", Object.keys(protectedBefore).length === profile.protectedState.length, Object.keys(protectedBefore));
  const networkBefore = await tcpSnapshot();
  live49620Before = listenersAt(networkBefore, profile.futureLiveCandidate.bridgePort);
  live49620EndpointsBefore = endpointsAt(networkBefore, profile.futureLiveCandidate.bridgePort);

  const ports = [profile.isolatedTopology.bridgePort, profile.isolatedTopology.httpPort];
  const initialFree = await Promise.all(ports.map((port) => portIsFree("127.0.0.1", port)));
  addCheck("ISOLATED_PORTS_FREE", initialFree.every(Boolean), ports.map((port, index) => ({ port, free: initialFree[index] })));
  if (!initialFree.every(Boolean)) throw new Error("isolated POC ports are occupied");

  cycle1 = await startCycle(profile, nodePath, entryPath, 1);
  addCheck("CYCLE1_HEALTH", cycle1.health.status === "ok" && cycle1.health.version === profile.runtime.packageVersion, cycle1.health);
  addCheck("CYCLE1_READINESS", cycle1.ready.status === "ok" && typeof cycle1.ready.uptime === "number", cycle1.ready);
  const c1Bridge = cycle1.listenerSummary.bridge;
  const c1Http = cycle1.listenerSummary.http;
  addCheck("CYCLE1_SINGLE_PROCESS_TWO_LISTENERS", c1Bridge.length === 1 && c1Http.length === 1 &&
    c1Bridge[0].pid === cycle1.child.pid && c1Http[0].pid === cycle1.child.pid && cycle1.allChildListeners.length === 2,
  { childPid: cycle1.child.pid, allChildListeners: cycle1.allChildListeners, ...cycle1.listenerSummary });
  addCheck("CYCLE1_LOOPBACK_ONLY", cycle1.allChildListeners.length === 2 &&
    cycle1.allChildListeners.every((row) => row.local.startsWith("127.0.0.1:")), cycle1.allChildListeners);

  const [sessionA, sessionB] = await Promise.all([
    initializeSession(cycle1.request, "yimi-eda-poc-client-a", 101),
    initializeSession(cycle1.request, "yimi-eda-poc-client-b", 201),
  ]);
  oldSessionForRestart = sessionB.id;
  addCheck("CYCLE1_TWO_DISTINCT_SESSIONS", sessionA.id !== sessionB.id &&
    sessionA.serverInfo?.version === profile.runtime.packageVersion && sessionB.serverInfo?.version === profile.runtime.packageVersion,
  { sessionAHash: sessionA.idHash, sessionBHash: sessionB.idHash, serverA: sessionA.serverInfo, serverB: sessionB.serverInfo });

  const [toolsA, toolsB] = await Promise.all([
    listTools(cycle1.request, sessionA.id, 102),
    listTools(cycle1.request, sessionB.id, 202),
  ]);
  addCheck("CYCLE1_TOOL_SURFACES_MATCH", toolsA.hasBridgeStatus && toolsB.hasBridgeStatus &&
    toolsA.hasWriteScopeProbe && toolsB.hasWriteScopeProbe && !toolsA.hasRawExecute && !toolsB.hasRawExecute &&
    toolsA.count === toolsB.count && toolsA.nameSetSha256 === toolsB.nameSetSha256, { toolsA, toolsB });

  const featureResult = await callTool(cycle1.request, sessionA.id, 105, "easyeda_get_feature_flags");
  const flags = featureResult?.structuredContent?.flags ?? {};
  const disabledFlags = [
    "jlcpcb_ordering_enabled", "jlcsearch_enabled", "mouser_enabled", "digikey_enabled",
    "oauth_enabled", "bridge_raw_exec_enabled", "raw_exec_experimental",
  ];
  addCheck("CYCLE1_FEATURES_DISABLED", disabledFlags.every((name) => flags[name] === false),
    Object.fromEntries(disabledFlags.map((name) => [name, flags[name] ?? null])));
  const writeProbeResult = await callTool(cycle1.request, sessionA.id, 106, "easyeda_schematic_place_component", {
    deviceItem: { libraryUuid: "POC-SCOPE-DENIAL", uuid: "POC-SCOPE-DENIAL" },
    x: 0,
    y: 0,
    confirmWrite: true,
  });
  const writeScopeDenied = writeProbeResult?.isError === true &&
    writeProbeResult?.structuredContent?.errorCode === "ERR_FORBIDDEN_SCOPE";
  addCheck("CYCLE1_WRITE_SCOPE_DENIED", writeScopeDenied, {
    isError: writeProbeResult?.isError ?? null,
    errorCode: writeProbeResult?.structuredContent?.errorCode ?? null,
    requiredScopes: writeProbeResult?.structuredContent?.details?.requiredScopes ?? null,
    configuredScopes: writeProbeResult?.structuredContent?.details?.configuredScopes ?? null,
  });
  addCheck("CYCLE1_RUNTIME_STORAGE_ISOLATED", cycle1.runtimeStorage.artifactsDirectory === true &&
    cycle1.runtimeStorage.cacheDirectory === true && cycle1.runtimeStorage.sqliteBytes >= 0 &&
    cycle1.runtimeStorage.root.startsWith(`${profile.isolatedRuntimeStorage.root}/`), cycle1.runtimeStorage);

  const [statusA, statusB] = await Promise.all([
    bridgeStatus(cycle1.request, sessionA.id, 103),
    bridgeStatus(cycle1.request, sessionB.id, 203),
  ]);
  addCheck("CYCLE1_PARALLEL_STATUS", statusA.activePort === profile.isolatedTopology.bridgePort &&
    statusB.activePort === profile.isolatedTopology.bridgePort, { statusA, statusB });
  addCheck("CYCLE1_BRIDGE_ISOLATED", statusA.connected === false && statusB.connected === false, { statusA, statusB });

  const deleteStatusA = await closeSession(cycle1.request, sessionA.id);
  const rejectedA = await waitForUnknownSession(cycle1.request, sessionA.id, 104);
  addCheck("CYCLE1_SESSION_A_CLOSED", [200, 202, 204].includes(deleteStatusA) && rejectedA.status === 404,
    { deleteStatus: deleteStatusA, reuseStatus: rejectedA.status });
  const statusBAfterAClosed = await bridgeStatus(cycle1.request, sessionB.id, 204);
  addCheck("CYCLE1_SESSION_B_SURVIVES", statusBAfterAClosed.activePort === profile.isolatedTopology.bridgePort &&
    statusBAfterAClosed.connected === false, statusBAfterAClosed);
  await closeSession(cycle1.request, sessionB.id);
  const cycle1Stop = await stopChild(cycle1.child);
  const cycle1PortsReleased = await waitForPortsFree(profile.isolatedTopology.httpHost,
    [profile.isolatedTopology.bridgePort, profile.isolatedTopology.httpPort]);
  addCheck("CYCLE1_STOP_RELEASES_PORTS", cycle1PortsReleased, cycle1Stop);
  cycles.push({
    cycle: 1,
    health: cycle1.health,
    ready: cycle1.ready,
    childPid: cycle1.child.pid,
    runtimeRoot: cycle1.runtimeRoot,
    listeners: cycle1.listenerSummary,
    allChildListeners: cycle1.allChildListeners,
    runtimeStorage: cycle1.runtimeStorage,
    sessions: [sessionA.idHash, sessionB.idHash],
    tools: toolsA,
    featureFlags: Object.fromEntries(disabledFlags.map((name) => [name, flags[name] ?? null])),
    writeScopeProbe: {
      isError: writeProbeResult?.isError ?? null,
      errorCode: writeProbeResult?.structuredContent?.errorCode ?? null,
      requiredScopes: writeProbeResult?.structuredContent?.details?.requiredScopes ?? null,
      configuredScopes: writeProbeResult?.structuredContent?.details?.configuredScopes ?? null,
    },
    status: [statusA, statusB],
    closeIsolation: { sessionADeleteStatus: deleteStatusA, sessionAReuseStatus: rejectedA.status, sessionBStatus: statusBAfterAClosed },
    stop: cycle1Stop,
    logs: cycle1.logs(),
  });

  cycle2 = await startCycle(profile, nodePath, entryPath, 2);
  addCheck("CYCLE2_HEALTH", cycle2.health.status === "ok" && cycle2.health.version === profile.runtime.packageVersion, cycle2.health);
  const c2Bridge = cycle2.listenerSummary.bridge;
  const c2Http = cycle2.listenerSummary.http;
  addCheck("CYCLE2_SINGLE_PROCESS_TWO_LISTENERS", c2Bridge.length === 1 && c2Http.length === 1 &&
    c2Bridge[0].pid === cycle2.child.pid && c2Http[0].pid === cycle2.child.pid && cycle2.allChildListeners.length === 2 &&
    cycle2.allChildListeners.every((row) => row.local.startsWith("127.0.0.1:")),
  { childPid: cycle2.child.pid, allChildListeners: cycle2.allChildListeners, ...cycle2.listenerSummary });
  addCheck("CYCLE2_RUNTIME_STORAGE_ISOLATED", cycle2.runtimeStorage.artifactsDirectory === true &&
    cycle2.runtimeStorage.cacheDirectory === true && cycle2.runtimeStorage.sqliteBytes >= 0 &&
    cycle2.runtimeStorage.root.startsWith(`${profile.isolatedRuntimeStorage.root}/`) &&
    cycle2.runtimeStorage.root !== cycle1.runtimeStorage.root, cycle2.runtimeStorage);
  const oldSessionRejected = await waitForUnknownSession(cycle2.request, oldSessionForRestart, 301);
  addCheck("CYCLE2_OLD_SESSION_REJECTED", oldSessionRejected.status === 404, oldSessionRejected.status);
  const sessionC = await initializeSession(cycle2.request, "yimi-eda-poc-client-after-restart", 302);
  addCheck("CYCLE2_NEW_SESSION_ALLOCATED", ![...cycles[0].sessions].includes(sessionC.idHash) &&
    sessionC.serverInfo?.version === profile.runtime.packageVersion,
  { sessionCHash: sessionC.idHash, serverInfo: sessionC.serverInfo });
  const statusC = await bridgeStatus(cycle2.request, sessionC.id, 303);
  addCheck("CYCLE2_BRIDGE_ISOLATED", statusC.activePort === profile.isolatedTopology.bridgePort && statusC.connected === false, statusC);
  await closeSession(cycle2.request, sessionC.id);
  const cycle2Stop = await stopChild(cycle2.child);
  const cycle2PortsReleased = await waitForPortsFree(profile.isolatedTopology.httpHost,
    [profile.isolatedTopology.bridgePort, profile.isolatedTopology.httpPort]);
  addCheck("CYCLE2_STOP_RELEASES_PORTS", cycle2PortsReleased, cycle2Stop);
  cycles.push({
    cycle: 2,
    health: cycle2.health,
    ready: cycle2.ready,
    childPid: cycle2.child.pid,
    runtimeRoot: cycle2.runtimeRoot,
    listeners: cycle2.listenerSummary,
    allChildListeners: cycle2.allChildListeners,
    runtimeStorage: cycle2.runtimeStorage,
    oldSessionStatus: oldSessionRejected.status,
    session: sessionC.idHash,
    status: statusC,
    stop: cycle2Stop,
    logs: cycle2.logs(),
  });

  protectedAfter = await captureProtected(profile);
  const networkAfter = await tcpSnapshot();
  live49620After = listenersAt(networkAfter, profile.futureLiveCandidate.bridgePort);
  live49620EndpointsAfter = endpointsAt(networkAfter, profile.futureLiveCandidate.bridgePort);
  addCheck("LIVE_49620_LISTENER_UNCHANGED", sameValue(live49620Before, live49620After), { before: live49620Before, after: live49620After });
  addCheck("LIVE_49620_ENDPOINTS_UNCHANGED", sameValue(live49620EndpointsBefore, live49620EndpointsAfter),
    { before: live49620EndpointsBefore, after: live49620EndpointsAfter });
  addCheck("PROTECTED_STATE_UNCHANGED", sameValue(protectedBefore, protectedAfter), {
    before: protectedBefore,
    after: protectedAfter,
  });
  const configText = await readFile(path.join(codexHome, "config.toml"), "utf8");
  const sectionStart = configText.indexOf("[mcp_servers.easyeda-mcp-pro]");
  const sectionTail = sectionStart >= 0 ? configText.slice(sectionStart) : "";
  const nextSection = sectionTail.slice(1).search(/\r?\n\[/);
  const section = nextSection >= 0 ? sectionTail.slice(0, nextSection + 1) : sectionTail;
  const remainsStdio = section.includes("command =") && section.includes("dist\\index.js") && !/\burl\s*=/.test(section);
  addCheck("GLOBAL_CONFIG_REMAINS_STDIO", remainsStdio, remainsStdio ? "stdio command entry retained" : "easyeda section changed or missing");
  addCheck("MIGRATION_CANDIDATE_NOT_APPLIED", profile.futureLiveCandidate.applyToGlobalConfig === false &&
    !configText.includes(profile.futureLiveCandidate.mcpUrl), profile.futureLiveCandidate);
} catch (error) {
  fatalError = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  for (const cycle of [cycle2, cycle1]) {
    if (cycle?.child && cycle.child.exitCode === null && cycle.child.signalCode === null) {
      try { await stopChild(cycle.child); } catch { /* final containment below records failure */ }
    }
  }
  if (profile?.isolatedTopology) {
    const released = await waitForPortsFree(profile.isolatedTopology.httpHost,
      [profile.isolatedTopology.bridgePort, profile.isolatedTopology.httpPort]);
    if (!released) fatalError = `${fatalError ?? ""}\nFinal containment did not release isolated ports.`.trim();
  }
}

if (fatalError) addCheck("POC_COMPLETED", false, fatalError);
const requiredIds = profile?.requiredCheckIds ?? [];
const actualIds = checks.map((item) => item.id);
const checkSetMatches = requiredIds.length === actualIds.length && requiredIds.every((id) => actualIds.includes(id));
const passed = !fatalError && checkSetMatches && checks.every((item) => item.passed);
const report = {
  schemaVersion: 1,
  reportKind: "jlceda-shared-http-poc-v1",
  profileId: profile?.profileId ?? null,
  profileSha256: profileBytes ? sha256(profileBytes) : null,
  startedAt,
  completedAt: new Date().toISOString(),
  runtime: profile ? {
    nodeVersion: profile.runtime.nodeVersion,
    packageName: profile.runtime.packageName,
    packageVersion: profile.runtime.packageVersion,
  } : null,
  harness: {
    runner: { path: "scripts/run-jlceda-shared-http-poc.mjs", ...await fileEvidence(path.join(root, "scripts", "run-jlceda-shared-http-poc.mjs")) },
    validator: { path: "scripts/validate-jlceda-shared-http-poc.mjs", ...await fileEvidence(path.join(root, "scripts", "validate-jlceda-shared-http-poc.mjs")) },
  },
  topology: profile?.isolatedTopology ?? null,
  isolatedRuntimeStorage: profile?.isolatedRuntimeStorage ?? null,
  effects: profile?.effects ?? null,
  protectedState: { before: protectedBefore, after: protectedAfter },
  live49620: { before: live49620Before, after: live49620After },
  live49620Endpoints: { before: live49620EndpointsBefore, after: live49620EndpointsAfter },
  cycles,
  checks,
  checkSummary: {
    expected: requiredIds.length,
    actual: actualIds.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
    exactRequiredSet: checkSetMatches,
  },
  limitations: {
    liveEdaExtensionConnection: "PENDING_CONTROLLED_MAINTENANCE_WINDOW",
    twoIndependentCodexDesktopTasks: "PENDING_CONTROLLED_MAINTENANCE_WINDOW",
    realEdaConcurrentCalls: "PENDING_CONTROLLED_MAINTENANCE_WINDOW",
    desktopUrlConfigRefresh: "PENDING_CONTROLLED_MAINTENANCE_WINDOW",
    stdioRollbackDrill: "PENDING_CONTROLLED_MAINTENANCE_WINDOW",
    guiEpipeLongRun: "PENDING_SEPARATE_FAILURE_LAYER",
  },
  passed,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`JLCEDA shared HTTP POC: ${passed ? "PASS" : "FAIL"} (${report.checkSummary.passed}/${report.checkSummary.expected})`);
console.log(`Report: ${path.relative(root, outputPath)}`);
if (!passed) process.exitCode = 1;
