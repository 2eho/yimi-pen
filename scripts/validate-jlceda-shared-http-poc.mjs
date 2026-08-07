import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const profilePath = path.join(root, "hardware", "evt0", "eda-shared-http-poc-v1", "profile.json");
const reportPath = path.join(root, "build", "jlceda-shared-http-poc.json");
const validationPath = path.join(root, "build", "jlceda-shared-http-poc-validation.json");
const profileBytes = await readFile(profilePath);
const [profile, report] = await Promise.all([
  Promise.resolve(JSON.parse(profileBytes.toString("utf8"))),
  readFile(reportPath, "utf8").then(JSON.parse),
]);
const checks = [];

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

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
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

async function captureProtectedState() {
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
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i);
    return match ? [{ local: match[1], remote: match[2], state: match[3].toUpperCase(), pid: Number(match[4]) }] : [];
  });
}

function endpointPort(endpoint) {
  const match = endpoint.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function endpointsAt(rows, port) {
  return rows
    .filter((row) => endpointPort(row.local) === port || endpointPort(row.remote) === port)
    .sort((left, right) => left.pid - right.pid || left.local.localeCompare(right.local) || left.remote.localeCompare(right.remote));
}

function validSessionHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function exactCycleListeners(cycle) {
  const expectedPorts = [profile.isolatedTopology.bridgePort, profile.isolatedTopology.httpPort].sort((a, b) => a - b);
  const listeners = cycle.allChildListeners ?? [];
  const actualPorts = listeners.map((row) => endpointPort(row.local)).sort((a, b) => a - b);
  return listeners.length === 2 && listeners.every((row) => row.pid === cycle.childPid && row.state === "LISTENING" &&
    row.local.startsWith("127.0.0.1:")) && sameValue(actualPorts, expectedPorts) &&
    cycle.listeners.bridge.length === 1 && cycle.listeners.http.length === 1;
}

const expectedEffects = {
  targetBindingEffect: "NONE",
  adapterEffect: "NONE",
  bomRevisionEffect: "NONE",
  releaseGateEffect: "NONE",
  purchaseAuthorizationEffect: "NONE",
  globalCodexConfigEffect: "NONE_NOT_APPLIED",
  liveEdaBridgeEffect: "NONE_ISOLATED_PORTS",
};
const actualIds = report.checks.map((item) => item.id);
check("profile identity", profile.schemaVersion === 1 && profile.profileId === "HW-EDA-SHARED-HTTP-POC-V1", profile.profileId);
check("report profile binding", report.profileId === profile.profileId && report.profileSha256 === sha256(profileBytes), report.profileSha256);
check("exact unique required check set", new Set(profile.requiredCheckIds).size === profile.requiredCheckIds.length &&
  new Set(actualIds).size === actualIds.length && profile.requiredCheckIds.length === actualIds.length &&
  profile.requiredCheckIds.every((id) => actualIds.includes(id)), `${actualIds.length}/${profile.requiredCheckIds.length}`);

const nodePath = path.join(codexHome, ...profile.runtime.nodeRelativeToCodexHome.split("/"));
const toolRoot = path.join(codexHome, ...profile.runtime.toolRootRelativeToCodexHome.split("/"));
const packageRoot = path.join(codexHome, ...profile.runtime.packageRelativeToCodexHome.split("/"));
const [{ stdout: nodeVersionStdout }, nodeEvidence, packageDocument, packageTree, toolPackageLock] = await Promise.all([
  execFileAsync(nodePath, ["--version"], { windowsHide: true }),
  fileEvidence(nodePath),
  readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
  treeEvidence(packageRoot),
  fileEvidence(path.join(toolRoot, profile.runtime.toolPackageLock.path)),
]);
const packageEvidence = [];
for (const expected of profile.runtime.evidenceFiles) {
  const actual = await fileEvidence(path.join(packageRoot, ...expected.path.split("/")));
  packageEvidence.push({ path: expected.path, matched: actual.bytes === expected.bytes && actual.sha256 === expected.sha256 });
}
check("runtime and package pins recomputed", nodeVersionStdout.trim() === profile.runtime.nodeVersion &&
  nodeEvidence.bytes === profile.runtime.nodeBytes && nodeEvidence.sha256 === profile.runtime.nodeSha256 &&
  packageDocument.name === profile.runtime.packageName && packageDocument.version === profile.runtime.packageVersion &&
  packageEvidence.every((item) => item.matched) && packageTree.fileCount === profile.runtime.packageTree.fileCount &&
  packageTree.totalBytes === profile.runtime.packageTree.totalBytes && packageTree.sha256 === profile.runtime.packageTree.sha256 &&
  toolPackageLock.bytes === profile.runtime.toolPackageLock.bytes && toolPackageLock.sha256 === profile.runtime.toolPackageLock.sha256 &&
  report.runtime.nodeVersion === profile.runtime.nodeVersion && report.runtime.packageVersion === profile.runtime.packageVersion,
{ nodeVersion: nodeVersionStdout.trim(), packageEvidence, packageTree, toolPackageLock });

const currentHarness = {
  runner: { path: "scripts/run-jlceda-shared-http-poc.mjs", ...await fileEvidence(path.join(root, "scripts", "run-jlceda-shared-http-poc.mjs")) },
  validator: { path: "scripts/validate-jlceda-shared-http-poc.mjs", ...await fileEvidence(path.join(root, "scripts", "validate-jlceda-shared-http-poc.mjs")) },
};
check("harness hashes recomputed", sameValue(report.harness, currentHarness), currentHarness);

const currentProtected = await captureProtectedState();
check("protected bytes and hashes recomputed", sameValue(report.protectedState.before, report.protectedState.after) &&
  sameValue(report.protectedState.after, currentProtected), Object.keys(currentProtected));

const isolatedPorts = [profile.isolatedTopology.bridgePort, profile.isolatedTopology.httpPort];
const freeStates = await Promise.all(isolatedPorts.map((port) => portIsFree(profile.isolatedTopology.httpHost, port)));
check("isolated ports independently confirmed free", freeStates.every(Boolean), isolatedPorts.map((port, index) => ({ port, free: freeStates[index] })));

const currentNetwork = await tcpSnapshot();
const currentLiveEndpoints = endpointsAt(currentNetwork, profile.futureLiveCandidate.bridgePort);
check("live 49620 endpoints independently preserved", sameValue(report.live49620Endpoints.before, report.live49620Endpoints.after) &&
  sameValue(report.live49620Endpoints.after, currentLiveEndpoints), { count: currentLiveEndpoints.length });

check("all runtime checks passed", report.passed === true && report.checks.every((item) => item.passed), report.checkSummary);
check("two exact lifecycle listener sets", report.cycles.length === 2 && report.cycles.every(exactCycleListeners),
  report.cycles.map((cycle) => ({ cycle: cycle.cycle, childPid: cycle.childPid, listeners: cycle.allChildListeners })));
check("two lifecycle cycles and session hashes", report.cycles.length === 2 && report.cycles[0].sessions.length === 2 &&
  report.cycles[0].sessions.every(validSessionHash) && validSessionHash(report.cycles[1].session),
report.cycles.map((cycle) => cycle.cycle));
const runtimeRoots = report.cycles.map((cycle) => path.resolve(root, cycle.runtimeStorage.root));
const allowedRuntimeRoot = path.resolve(root, profile.isolatedRuntimeStorage.root);
const storageStats = await Promise.all(report.cycles.map(async (cycle) => {
  const runtimeRoot = path.resolve(root, cycle.runtimeStorage.root);
  const sqlite = path.resolve(root, cycle.runtimeStorage.sqlite);
  const relativeRoot = path.relative(allowedRuntimeRoot, runtimeRoot);
  const [rootInfo, sqliteInfo, artifactsInfo, cacheInfo] = await Promise.all([
    stat(runtimeRoot), stat(sqlite), stat(path.join(runtimeRoot, "artifacts")), stat(path.join(runtimeRoot, "cache")),
  ]);
  return {
    contained: !relativeRoot.startsWith("..") && !path.isAbsolute(relativeRoot),
    rootDirectory: rootInfo.isDirectory(), sqliteFile: sqliteInfo.isFile(),
    artifactsDirectory: artifactsInfo.isDirectory(), cacheDirectory: cacheInfo.isDirectory(),
  };
}));
check("cycle runtime storage independently isolated", new Set(runtimeRoots).size === 2 &&
  storageStats.every((item) => Object.values(item).every(Boolean)), storageStats);
check("session isolation recorded", report.cycles[0].sessions[0] !== report.cycles[0].sessions[1] &&
  report.cycles[0].closeIsolation.sessionAReuseStatus === 404 &&
  report.cycles[0].closeIsolation.sessionBStatus.activePort === profile.isolatedTopology.bridgePort,
report.cycles[0].closeIsolation);
check("restart invalidates old session", report.cycles[1].oldSessionStatus === 404 &&
  !report.cycles[0].sessions.includes(report.cycles[1].session), report.cycles[1].oldSessionStatus);
check("isolated bridge remains disconnected", report.cycles.every((cycle) =>
  (Array.isArray(cycle.status) ? cycle.status : [cycle.status]).every((status) =>
    status.connected === false && status.activePort === profile.isolatedTopology.bridgePort)), profile.isolatedTopology.bridgePort);
check("stop paths stayed bounded", report.cycles.every((cycle) => cycle.stop.forced === false && cycle.stop.signalCode === "SIGTERM"),
  report.cycles.map((cycle) => cycle.stop));
const disabledFlags = [
  "jlcpcb_ordering_enabled", "jlcsearch_enabled", "mouser_enabled", "digikey_enabled",
  "oauth_enabled", "bridge_raw_exec_enabled", "raw_exec_experimental",
];
check("disabled features and write scope denial recorded", disabledFlags.every((name) => report.cycles[0].featureFlags[name] === false) &&
  report.cycles[0].tools.hasRawExecute === false && report.cycles[0].writeScopeProbe.isError === true &&
  report.cycles[0].writeScopeProbe.errorCode === "ERR_FORBIDDEN_SCOPE", {
  featureFlags: report.cycles[0].featureFlags,
  writeScopeProbe: report.cycles[0].writeScopeProbe,
});

const configPath = path.join(codexHome, "config.toml");
const configText = await readFile(configPath, "utf8");
const sectionStart = configText.indexOf("[mcp_servers.easyeda-mcp-pro]");
const sectionTail = sectionStart >= 0 ? configText.slice(sectionStart) : "";
const nextSection = sectionTail.slice(1).search(/\r?\n\[/);
const section = nextSection >= 0 ? sectionTail.slice(0, nextSection + 1) : sectionTail;
check("global stdio config independently preserved", section.includes("command =") && section.includes("dist\\index.js") &&
  !/\burl\s*=/.test(section) && !configText.includes(profile.futureLiveCandidate.mcpUrl),
{ bytes: Buffer.byteLength(configText), sha256: sha256(configText) });
check("effects remain non-promoting", sameValue(profile.effects, expectedEffects) && sameValue(report.effects, expectedEffects), report.effects);
check("live migration remains pending", Object.values(report.limitations).every((value) => value.startsWith("PENDING_")) &&
  profile.futureLiveCandidate.applyToGlobalConfig === false, report.limitations);

const validation = {
  schemaVersion: 1,
  reportKind: "jlceda-shared-http-poc-validation-v1",
  validatedAt: new Date().toISOString(),
  profileId: profile.profileId,
  checks,
  checkSummary: {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  },
  passed: checks.every((item) => item.passed),
};
await mkdir(path.dirname(validationPath), { recursive: true });
await writeFile(validationPath, `${JSON.stringify(validation, null, 2)}\n`, "utf8");
console.log(`JLCEDA shared HTTP POC validation: ${validation.passed ? "PASS" : "FAIL"} (${validation.checkSummary.passed}/${validation.checkSummary.total})`);
console.log(`Report: ${path.relative(root, validationPath)}`);
if (!validation.passed) process.exitCode = 1;
