import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "architecture/system-boundaries.v1.json");
const POLICY_SCHEMA_PATH = path.join(ROOT, "architecture/system-boundaries.schema.json");
const REPORT_PATH = path.join(ROOT, "build/architecture-validation.json");
const results = [];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function check(id, passed, detail) {
  results.push({ id, passed: Boolean(passed), detail });
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function sameSet(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function exists(target) {
  try {
    return (await stat(target)).isFile() || (await stat(target)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function filesBelow(root, predicate) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["build", "dist", "node_modules", "target", ".git", ".venv"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && predicate(absolute)) files.push(absolute);
    }
  }
  await walk(root);
  return files;
}

function cycleIn(graph) {
  const visiting = new Set();
  const visited = new Set();
  const trail = [];
  function visit(node) {
    if (visiting.has(node)) return [...trail, node];
    if (visited.has(node)) return null;
    visiting.add(node);
    trail.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    trail.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

function productionDependencies(toml) {
  const dependencies = [];
  let section = "";
  for (const rawLine of toml.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== "dependencies") continue;
    const dependencyMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (dependencyMatch) {
      dependencies.push({
        name: dependencyMatch[1],
        pathDependency: /\bpath\s*=/u.test(dependencyMatch[2]),
      });
    }
  }
  return dependencies;
}

const [policyBytes, schema] = await Promise.all([readFile(POLICY_PATH), readJson(POLICY_SCHEMA_PATH)]);
const policy = JSON.parse(policyBytes.toString("utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validatePolicy = ajv.compile(schema);
const policyValid = validatePolicy(policy);
check(
  "policy-schema",
  policyValid,
  policyValid ? "Draft 2020-12 policy schema passed" : ajv.errorsText(validatePolicy.errors, { separator: " | " }),
);

const rootPackage = await readJson(path.join(ROOT, "package.json"));
const internalPrefix = "@yimi-pen/";
const nodePolicyByName = new Map(policy.nodeWorkspaces.map((workspace) => [workspace.name, workspace]));
check(
  "node-policy-unique-names",
  nodePolicyByName.size === policy.nodeWorkspaces.length,
  `declared=${policy.nodeWorkspaces.length} unique=${nodePolicyByName.size}`,
);
check(
  "node-policy-unique-roots",
  new Set(policy.nodeWorkspaces.map((workspace) => workspace.root)).size === policy.nodeWorkspaces.length,
  "each workspace root has one policy owner",
);

const actualNodeWorkspaces = [];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(path.join(ROOT, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(ROOT, parent, entry.name, "package.json");
    if (await exists(manifestPath)) actualNodeWorkspaces.push(await readJson(manifestPath));
  }
}
check(
  "node-workspace-coverage",
  sameSet(actualNodeWorkspaces.map((workspace) => workspace.name), [...nodePolicyByName.keys()]),
  `actual=${sorted(actualNodeWorkspaces.map((workspace) => workspace.name)).join(",")} policy=${sorted(nodePolicyByName.keys()).join(",")}`,
);

const nodeGraph = new Map();
for (const workspace of policy.nodeWorkspaces) {
  const manifestPath = path.join(ROOT, workspace.root, "package.json");
  const manifestPresent = await exists(manifestPath);
  check(`node-manifest-${workspace.name}`, manifestPresent, workspace.root);
  if (!manifestPresent) continue;
  const manifest = await readJson(manifestPath);
  check(`node-name-${workspace.name}`, manifest.name === workspace.name, `manifest=${manifest.name}`);
  const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const internalDependencies = [];
  for (const section of dependencySections) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith(internalPrefix)) continue;
      internalDependencies.push(name);
      check(
        `node-internal-version-${workspace.name}-${name}`,
        version === rootPackage.version,
        `expected=${rootPackage.version} actual=${version}`,
      );
    }
  }
  check(
    `node-dependencies-${workspace.name}`,
    sameSet(internalDependencies, workspace.allowedInternalDependencies),
    `actual=${sorted(internalDependencies).join(",") || "none"} allowed=${sorted(workspace.allowedInternalDependencies).join(",") || "none"}`,
  );
  nodeGraph.set(workspace.name, workspace.allowedInternalDependencies);

  const allowedCompositionImports = workspace.allowedCompositionImports ?? [];
  check(
    `node-composition-import-role-${workspace.name}`,
    allowedCompositionImports.length === 0 || workspace.role === "composition-root",
    `role=${workspace.role} allowed=${allowedCompositionImports.join(",") || "none"}`,
  );
  for (const allowedImport of allowedCompositionImports) {
    check(
      `node-composition-import-exists-${workspace.name}-${allowedImport}`,
      await exists(path.join(ROOT, allowedImport)),
      "declared composition import root exists",
    );
  }

  const sourceRoot = path.join(ROOT, workspace.root, "src");
  if (!(await exists(sourceRoot))) continue;
  const sources = await filesBelow(sourceRoot, (target) => /\.(?:cjs|js|mjs|ts|tsx)$/u.test(target));
  for (const source of sources) {
    const text = await readFile(source, "utf8");
    const relative = path.relative(ROOT, source).replaceAll("\\", "/");
    const importSpecifiers = [
      ...text.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu),
    ].map((match) => match[1]);
    for (const specifier of importSpecifiers.filter((value) => value.startsWith("."))) {
      const resolved = path.resolve(path.dirname(source), specifier);
      const workspaceRoot = path.join(ROOT, workspace.root);
      const relativeToWorkspace = path.relative(workspaceRoot, resolved);
      const insideWorkspace = relativeToWorkspace !== ".."
        && !relativeToWorkspace.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativeToWorkspace);
      const relativeToRepository = path.relative(ROOT, resolved).replaceAll("\\", "/");
      const insideRepository = relativeToRepository !== ".."
        && !relativeToRepository.startsWith("../")
        && !path.isAbsolute(relativeToRepository);
      const declaredCompositionImport = insideRepository && allowedCompositionImports.some(
        (allowed) => relativeToRepository === allowed || relativeToRepository.startsWith(`${allowed}/`),
      );
      check(
        `node-relative-boundary-${relative}-${specifier}`,
        insideWorkspace || declaredCompositionImport,
        insideWorkspace
          ? "relative source import stays inside its workspace"
          : `repo=${relativeToRepository} declared=${declaredCompositionImport}`,
      );
    }
    const internalSpecifiers = [...text.matchAll(/["'](@yimi-pen\/[^"']+)["']/gu)].map((match) => match[1]);
    for (const specifier of internalSpecifiers) {
      const segments = specifier.split("/");
      const packageName = segments.slice(0, 2).join("/");
      check(`node-public-import-${relative}-${specifier}`, specifier === packageName, "deep internal imports are not allowed");
      check(
        `node-declared-import-${relative}-${packageName}`,
        workspace.allowedInternalDependencies.includes(packageName),
        "source import must be declared by the architecture graph",
      );
    }
    const nodeBuiltinUsed = /(?:from\s+|import\s*\()\s*["']node:/u.test(text);
    if (!workspace.allowNodeBuiltins) {
      check(`node-builtin-${relative}`, !nodeBuiltinUsed, "pure workspace excludes Node builtins");
    }
  }
}
const nodeCycle = cycleIn(nodeGraph);
check("node-dependency-acyclic", nodeCycle === null, nodeCycle?.join(" -> ") ?? "no cycle");

const rust = policy.rustWorkspace;
const rootCargoText = await readFile(path.join(ROOT, rust.manifest), "utf8");
const membersBlock = /members\s*=\s*\[([\s\S]*?)\]/u.exec(rootCargoText)?.[1] ?? "";
const cargoMembers = [...membersBlock.matchAll(/["']([^"']+)["']/gu)]
  .map((match) => path.posix.join(path.posix.dirname(rust.manifest), match[1]));
check(
  "rust-workspace-coverage",
  sameSet(cargoMembers, rust.crates.map((crate) => crate.root)),
  `cargo=${sorted(cargoMembers).join(",")} policy=${sorted(rust.crates.map((crate) => crate.root)).join(",")}`,
);

const rustGraph = new Map();
const rustNames = new Set(rust.crates.map((crate) => crate.name));
for (const crate of rust.crates) {
  const manifestPath = path.join(ROOT, crate.root, "Cargo.toml");
  const cargoText = await readFile(manifestPath, "utf8");
  const packageName = /^name\s*=\s*"([^"]+)"/mu.exec(cargoText)?.[1];
  check(`rust-name-${crate.name}`, packageName === crate.name, `manifest=${packageName ?? "missing"}`);
  const dependencies = productionDependencies(cargoText);
  const pathDependencies = dependencies.filter((dependency) => dependency.pathDependency).map((dependency) => dependency.name);
  const externalDependencies = dependencies.filter((dependency) => !dependency.pathDependency).map((dependency) => dependency.name);
  check(
    `rust-path-dependencies-${crate.name}`,
    sameSet(pathDependencies, crate.allowedProductionPathDependencies),
    `actual=${sorted(pathDependencies).join(",") || "none"} allowed=${sorted(crate.allowedProductionPathDependencies).join(",") || "none"}`,
  );
  check(
    `rust-known-path-dependencies-${crate.name}`,
    pathDependencies.every((dependency) => rustNames.has(dependency)),
    "all path dependencies resolve to policy-owned crates",
  );
  if (!crate.allowExternalProductionDependencies) {
    check(
      `rust-external-dependencies-${crate.name}`,
      externalDependencies.length === 0,
      externalDependencies.join(",") || "none",
    );
  }
  rustGraph.set(crate.name, crate.allowedProductionPathDependencies);
}
const rustCycle = cycleIn(rustGraph);
check("rust-dependency-acyclic", rustCycle === null, rustCycle?.join(" -> ") ?? "no cycle");

for (const crateName of rust.pureCoreCrates) {
  const crate = rust.crates.find((candidate) => candidate.name === crateName);
  check(`rust-pure-core-declared-${crateName}`, Boolean(crate), crate?.root ?? "missing policy crate");
  if (!crate) continue;
  const libPath = path.join(ROOT, crate.root, "src/lib.rs");
  const libText = await readFile(libPath, "utf8");
  check(`rust-no-std-${crateName}`, libText.startsWith("#![no_std]"), path.relative(ROOT, libPath));
  const sources = await filesBelow(path.join(ROOT, crate.root, "src"), (target) => target.endsWith(".rs"));
  const joined = (await Promise.all(sources.map((source) => readFile(source, "utf8")))).join("\n").toLowerCase();
  for (const token of rust.forbiddenVendorTokensInPureCore) {
    check(`rust-vendor-neutral-${crateName}-${token}`, !joined.includes(token.toLowerCase()), "vendor token stays outside pure core");
  }
}

const allowedUnsafe = new Set(rust.allowedUnsafeRustFiles);
const rustSources = await filesBelow(path.join(ROOT, "firmware"), (target) => target.endsWith(".rs"));
const unsafeFiles = [];
for (const source of rustSources) {
  const text = await readFile(source, "utf8");
  if (/\bunsafe\s*(?:extern|\{|fn\b|impl\b|trait\b)/u.test(text)) {
    unsafeFiles.push(path.relative(ROOT, source).replaceAll("\\", "/"));
  }
}
check(
  "rust-unsafe-boundary",
  unsafeFiles.every((source) => allowedUnsafe.has(source)) && [...allowedUnsafe].every((source) => unsafeFiles.includes(source)),
  `actual=${sorted(unsafeFiles).join(",") || "none"} allowed=${sorted(allowedUnsafe).join(",")}`,
);

const canonicalOwners = new Map();
for (const owner of policy.contractOwners) {
  for (const canonicalPath of owner.canonicalPaths) {
    check(`contract-path-${owner.id}-${canonicalPath}`, await exists(path.join(ROOT, canonicalPath)), "canonical path exists");
    const previous = canonicalOwners.get(canonicalPath);
    check(`contract-single-owner-${canonicalPath}`, previous === undefined, previous ? `also owned by ${previous}` : owner.id);
    canonicalOwners.set(canonicalPath, owner.id);
  }
  for (const consumer of owner.consumers) {
    check(`contract-consumer-${owner.id}-${consumer}`, await exists(path.join(ROOT, consumer)), "consumer exists");
  }
  const gate = /^npm run ([a-z0-9:-]+)$/u.exec(owner.conformanceGate)?.[1];
  check(`contract-gate-${owner.id}`, Boolean(gate && rootPackage.scripts?.[gate]), owner.conformanceGate);
}

const integrationGateIds = policy.integrationGates.map((gate) => gate.id);
check(
  "integration-gate-unique-ids",
  new Set(integrationGateIds).size === integrationGateIds.length,
  integrationGateIds.join(","),
);
for (const gate of policy.integrationGates) {
  for (const ownerDoc of gate.ownerDocs) {
    check(`integration-gate-owner-${gate.id}-${ownerDoc}`, await exists(path.join(ROOT, ownerDoc)), "owner document exists");
  }
}

const schemaIds = new Map();
const jsonFiles = await filesBelow(ROOT, (target) => target.endsWith(".json"));
for (const jsonFile of jsonFiles) {
  let document;
  try {
    document = await readJson(jsonFile);
  } catch {
    continue;
  }
  if (typeof document?.$id !== "string") continue;
  const relative = path.relative(ROOT, jsonFile).replaceAll("\\", "/");
  const previous = schemaIds.get(document.$id);
  check(`schema-id-${document.$id}`, previous === undefined, previous ? `${previous} and ${relative}` : relative);
  schemaIds.set(document.$id, relative);
}

for (const requiredDoc of policy.qualityGates.requiredDocs) {
  check(`required-doc-${requiredDoc}`, await exists(path.join(ROOT, requiredDoc)), "required architecture document exists");
}
for (const automation of policy.qualityGates.requiredAutomation) {
  const automationPath = path.join(ROOT, automation);
  const automationExists = await exists(automationPath);
  check(`required-automation-${automation}`, automationExists, "required automation exists");
  if (automationExists && /\.ya?ml$/u.test(automation)) {
    const workflowText = await readFile(automationPath, "utf8");
    const actionRefs = [...workflowText.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gmu)].map((match) => match[1]);
    check(`automation-action-pins-${automation}`, actionRefs.length > 0 && actionRefs.every((ref) => /^[a-f0-9]{40}$/u.test(ref)), actionRefs.join(",") || "none");
    check(`automation-read-only-${automation}`, /^permissions:\s*\r?\n\s+contents:\s+read\s*$/mu.test(workflowText), "workflow has read-only default contents permission");
    check(`automation-contract-gate-${automation}`, workflowText.includes("npm run validate:contracts"), "PR/push contract gate exists");
    check(`automation-full-gate-${automation}`, workflowText.includes("npm run validate:full"), "scheduled/manual full gate exists");
  }
}
for (const stableRoot of policy.qualityGates.protectedStableRoots) {
  check(`stable-root-${stableRoot}`, await exists(path.join(ROOT, stableRoot)), "protected stable root exists");
}
for (const script of policy.qualityGates.requiredRootScripts) {
  check(`required-script-${script}`, typeof rootPackage.scripts?.[script] === "string", rootPackage.scripts?.[script] ?? "missing");
}
const aggregate = rootPackage.scripts?.[policy.qualityGates.aggregateScript] ?? "";
const sealedAggregatePath = "tools/release-gates/run-product-rd.mjs";
const sealedAggregate = aggregate.includes(sealedAggregatePath)
  ? await readFile(path.join(ROOT, sealedAggregatePath), "utf8")
  : "";
check(
  "architecture-in-aggregate",
  aggregate.includes("npm run validate:architecture")
    || (aggregate.includes(sealedAggregatePath) && sealedAggregate.includes('"validate:architecture"')),
  `${policy.qualityGates.aggregateScript}=${aggregate}`,
);

const failures = results.filter((result) => !result.passed);
const report = {
  schemaVersion: 1,
  profile: "yimi-architecture-validation-v1",
  policySha256: sha256(policyBytes),
  valid: failures.length === 0,
  integrationReady: policy.integrationGates.every((gate) => gate.status === "CLOSED"),
  summary: {
    checks: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    nodeWorkspaces: policy.nodeWorkspaces.length,
    rustCrates: rust.crates.length,
    contractOwners: policy.contractOwners.length,
    canonicalContractPaths: canonicalOwners.size,
    schemaIds: schemaIds.size,
    openIntegrationGates: policy.integrationGates.filter((gate) => gate.status !== "CLOSED").length,
  },
  dependencyGraphs: {
    node: Object.fromEntries([...nodeGraph].map(([name, dependencies]) => [name, sorted(dependencies)])),
    rust: Object.fromEntries([...rustGraph].map(([name, dependencies]) => [name, sorted(dependencies)])),
  },
  integrationGates: policy.integrationGates,
  failures,
};

await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Architecture policy valid: ${report.valid}`);
console.log(`Checks: ${report.summary.passed}/${report.summary.checks} passed`);
console.log(`Node workspaces: ${report.summary.nodeWorkspaces}; Rust crates: ${report.summary.rustCrates}; contract owners: ${report.summary.contractOwners}`);
console.log(`Integration ready: ${report.integrationReady}; open gates: ${report.summary.openIntegrationGates}`);
console.log(`Report: ${REPORT_PATH}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure.id}: ${failure.detail}`);
  process.exitCode = 1;
}
