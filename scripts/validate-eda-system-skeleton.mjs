import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256 } from "./snapshot-jcs.mjs";
import {
  buildArtifactSet,
  checkArtifactSet,
  loadSkeletonInputs,
} from "./generate-eda-system-skeleton.mjs";

const root = process.cwd();
const packageRoot = "hardware/evt0/eda-system-skeleton-v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function topologyHashInput(topology) {
  const { topologyId: _topologyId, ...input } = topology;
  return input;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function fileIdentity(relativePath) {
  const bytes = await readFile(path.join(root, relativePath));
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
}

const forbiddenNormalizedKeys = new Set([
  "mpn",
  "manufacturerpartnumber",
  "partnumber",
  "component",
  "componentid",
  "symbol",
  "symbolid",
  "symboluuid",
  "library",
  "libraryuuid",
  "footprint",
  "package",
  "designator",
  "refdes",
  "pin",
  "pinmap",
  "pinout",
  "net",
  "netname",
  "physicalnet",
  "rail",
  "railvoltage",
  "voltage",
  "current",
  "impedance",
  "connector",
  "connectorid",
  "header",
  "receptacle",
  "pcblayout",
  "boardoutline",
  "layer",
  "track",
  "route",
  "via",
  "pad",
  "copper",
  "keepout",
  "gerber",
  "drill",
  "bom",
  "targetidentity",
  "interfacebindings",
  "boardmpn",
  "pcbrev",
  "headmpn",
  "headrev",
  "firmwareversion",
]);

const forbiddenKeyFragments = [
  "component",
  "symbol",
  "library",
  "footprint",
  "designator",
  "refdes",
  "pinmap",
  "pinout",
  "netname",
  "physicalnet",
  "rail",
  "voltage",
  "current",
  "impedance",
  "connector",
  "receptacle",
  "pcblayout",
  "boardoutline",
  "gerber",
  "drill",
  "targetidentity",
  "interfacebindings",
  "boardmpn",
  "pcbrev",
  "headmpn",
  "headrev",
  "firmwareversion",
];

function normalizedKey(key) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function collectForbiddenFieldPaths(value, currentPath = "$") {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...collectForbiddenFieldPaths(item, `${currentPath}[${index}]`)));
    return violations;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = `${currentPath}.${key}`;
      const normalized = normalizedKey(key);
      if (
        forbiddenNormalizedKeys.has(normalized) ||
        forbiddenKeyFragments.some((fragment) => normalized.includes(fragment))
      ) {
        violations.push(nextPath);
      }
      violations.push(...collectForbiddenFieldPaths(child, nextPath));
    }
  }
  return violations;
}

const implementationPatterns = [
  { name: "voltage value", pattern: /(?:^|[^A-Za-z0-9])\d+(?:\.\d+)?\s*(?:mV|V)(?:$|[^A-Za-z0-9])/i },
  { name: "current value", pattern: /(?:^|[^A-Za-z0-9])\d+(?:\.\d+)?\s*(?:uA|mA|A)(?:$|[^A-Za-z0-9])/i },
  { name: "physical dimension", pattern: /(?:^|[^A-Za-z0-9])\d+(?:\.\d+)?\s*(?:mm|mil|inch)(?:$|[^A-Za-z0-9])/i },
  { name: "reference designator", pattern: /(?:^|[^A-Za-z0-9])(?:R|C|L|Q|U|D|J)\d{1,4}(?:$|[^A-Za-z0-9])/ },
  { name: "physical GPIO", pattern: /\bGPIO[_-]?\d+\b/i },
];

export function collectImplementationLikeStrings(value, currentPath = "$") {
  const violations = [];
  if (typeof value === "string") {
    for (const item of implementationPatterns) {
      if (item.pattern.test(value)) violations.push(`${currentPath}: ${item.name} in ${JSON.stringify(value)}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...collectImplementationLikeStrings(item, `${currentPath}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      violations.push(...collectImplementationLikeStrings(child, `${currentPath}.${key}`));
    }
  }
  return violations;
}

function placementViolations(profile, topology) {
  const violations = [];
  const placements = profile.diagramLayout.rolePlacements;
  const placementRoles = placements.map((item) => item.role);
  const topologyRoles = topology.blocks.map((item) => item.role);
  if (!unique(placementRoles)) violations.push("diagram roles are not unique");
  if (!sameArray([...placementRoles].sort(), [...topologyRoles].sort())) {
    violations.push("diagram roles do not exactly cover topology roles");
  }
  const { width: canvasWidth, height: canvasHeight } = profile.diagramLayout.canvas;
  for (const item of placements) {
    if (item.x + item.width > canvasWidth || item.y + item.height > canvasHeight) {
      violations.push(`${item.role} is outside the preview canvas`);
    }
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const separated =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      if (!separated) violations.push(`${a.role} overlaps ${b.role}`);
    }
  }
  return violations;
}

export function validateModelSemantics({ profile, topology, targetBinding, edaManifest, artifactSet }) {
  const violations = [];
  if (profile.sources.topology.topologyId !== topology.topologyId) violations.push("profile topology identity drifted");
  if (topology.blocks.length !== 12) violations.push(`expected 12 topology blocks, got ${topology.blocks.length}`);
  const logicalPortCount = topology.blocks.reduce((count, block) => count + block.ports.length, 0);
  if (logicalPortCount !== 36) violations.push(`expected 36 topology ports, got ${logicalPortCount}`);
  if (topology.interfaces.length !== 18) violations.push(`expected 18 topology interfaces, got ${topology.interfaces.length}`);
  if (targetBinding.targetIdentity.state !== profile.sources.targetBinding.requiredTargetState) {
    violations.push(`target state is ${targetBinding.targetIdentity.state}`);
  }
  if (targetBinding.eda.readiness !== profile.sources.targetBinding.requiredEdaReadiness) {
    violations.push(`EDA readiness is ${targetBinding.eda.readiness}`);
  }
  if (targetBinding.eda.systemSkeletonReady !== profile.sources.targetBinding.requiredSystemSkeletonReady) {
    violations.push("system skeleton readiness drifted");
  }
  if (targetBinding.eda.chipLevelReady !== profile.sources.targetBinding.requiredChipLevelReady) {
    violations.push("chip-level readiness drifted");
  }
  if (!sameArray(targetBinding.eda.permittedWork, profile.scope.permittedWork)) {
    violations.push("permitted EDA work drifted");
  }
  if (!sameArray(targetBinding.eda.blockedWork, profile.scope.blockedWork)) {
    violations.push("blocked EDA work drifted");
  }
  if (edaManifest.eda.projectName !== profile.sources.edaManifest.requiredProjectName) {
    violations.push(`EDA project name is ${edaManifest.eda.projectName}`);
  }
  if (edaManifest.eda.projectRevision !== profile.sources.edaManifest.requiredProjectRevision) {
    violations.push(`EDA project revision is ${edaManifest.eda.projectRevision}`);
  }
  if (edaManifest.codexBridge.designWrite !== profile.sources.edaManifest.requiredDesignWrite) {
    violations.push(`EDA designWrite is ${edaManifest.codexBridge.designWrite}`);
  }
  if (edaManifest.artifacts.length !== profile.sources.edaManifest.requiredArtifactCount) {
    violations.push(`EDA artifact count is ${edaManifest.artifacts.length}`);
  }
  violations.push(...placementViolations(profile, topology));
  const skeleton = artifactSet.logicalSkeleton;
  const writePlan = artifactSet.writePlan;
  const expectedArtifactSet = buildArtifactSet(profile, topology, targetBinding);
  if (JSON.stringify(skeleton) !== JSON.stringify(expectedArtifactSet.logicalSkeleton)) {
    violations.push("logical skeleton is not the exact deterministic topology projection");
  }
  if (JSON.stringify(writePlan) !== JSON.stringify(expectedArtifactSet.writePlan)) {
    violations.push("write plan is not the exact deterministic skeleton projection");
  }
  if (skeleton.hierarchy.rootSheet.nodes.length !== topology.blocks.length) violations.push("skeleton block coverage drifted");
  if (skeleton.hierarchy.rootSheet.edges.length !== topology.interfaces.length) violations.push("skeleton interface coverage drifted");
  if (skeleton.hierarchy.leafSheets.length !== topology.blocks.length) violations.push("leaf sheet coverage drifted");
  if (writePlan.nativeSourceGenerated !== false || writePlan.nativeExportGenerated !== false) {
    violations.push("native EDA artifact state changed");
  }
  if (Object.values(writePlan.executionIdentity).some((value) => value !== null)) {
    violations.push("unexecuted write plan contains a native EDA identity");
  }
  if (writePlan.interfacePolicy.edaWireCount !== 0 || writePlan.interfacePolicy.edaBusCount !== 0) {
    violations.push("write plan contains electrical wire or bus intent");
  }
  if (!sameArray(writePlan.interfacePolicy.allowedFuturePrimitiveKinds, ["RECTANGLE", "TEXT"])) {
    violations.push("future primitive whitelist drifted");
  }
  const forbiddenFields = [
    ...collectForbiddenFieldPaths(skeleton, "$.logicalSkeleton"),
    ...collectForbiddenFieldPaths(writePlan, "$.writePlan"),
  ];
  if (forbiddenFields.length > 0) violations.push(`forbidden implementation fields: ${forbiddenFields.join(", ")}`);
  const implementationStrings = [
    ...collectImplementationLikeStrings(skeleton, "$.logicalSkeleton"),
    ...collectImplementationLikeStrings(writePlan, "$.writePlan"),
  ];
  if (implementationStrings.length > 0) violations.push(`implementation-like values: ${implementationStrings.join(" | ")}`);
  return violations;
}

function countOccurrences(text, fragment) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(fragment, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + fragment.length;
  }
}

function validateSvg(svg, artifactSet) {
  const violations = [];
  const skeleton = artifactSet.logicalSkeleton;
  if (!svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')) violations.push("SVG document header is invalid");
  if (!svg.includes(escapeForXml(skeleton.skeletonId))) violations.push("SVG skeleton identity is missing");
  if (!svg.includes(escapeForXml(artifactSet.writePlan.writePlanId))) violations.push("SVG write-plan identity is missing");
  for (const node of skeleton.hierarchy.rootSheet.nodes) {
    if (countOccurrences(svg, `id="block-${node.blockId}"`) !== 1) violations.push(`SVG block identity ${node.blockId} count drifted`);
  }
  for (const edge of skeleton.hierarchy.rootSheet.edges) {
    if (countOccurrences(svg, `id="interface-${edge.interfaceId}"`) !== 1) violations.push(`SVG interface ${edge.interfaceId} count drifted`);
    if (countOccurrences(svg, `id="legend-${edge.interfaceId}"`) !== 1) violations.push(`SVG legend ${edge.interfaceId} count drifted`);
  }
  for (const forbidden of ["<script", "<foreignObject", "marker-end=", "<image", "<a "]) {
    if (svg.includes(forbidden)) violations.push(`SVG contains forbidden token ${forbidden}`);
  }
  return violations;
}

function escapeForXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function evidenceViolations(evidence, profile) {
  const violations = [];
  if (evidence.schemaVersion !== 1) violations.push("evidence schemaVersion drifted");
  if (evidence.evidenceSetId !== profile.sources.officialEvidence.evidenceSetId) violations.push("evidence set identity drifted");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(evidence.retrievedAt)) violations.push("evidence retrieval time is invalid");
  const repositoryCommits = new Set(evidence.repositories.map((item) => item.commit));
  if (!unique(evidence.repositories.map((item) => item.repository))) violations.push("evidence repositories are duplicated");
  for (const repository of evidence.repositories) {
    if (!repository.repository.startsWith("https://github.com/easyeda/")) violations.push(`non-official repository ${repository.repository}`);
    if (!/^[0-9a-f]{40}$/.test(repository.commit)) violations.push(`invalid repository commit ${repository.commit}`);
    if (repository.workingTreeState !== "CLEAN") violations.push(`repository state is ${repository.workingTreeState}`);
  }
  const sourceIds = evidence.artifacts.map((item) => item.sourceId);
  if (!unique(sourceIds)) violations.push("official evidence source IDs are duplicated");
  const sourceIdSet = new Set(sourceIds);
  for (const item of evidence.artifacts) {
    if (!repositoryCommits.has(item.repositoryCommit)) violations.push(`${item.sourceId} has an unbound commit`);
    if (!item.url.startsWith("https://github.com/easyeda/") || !item.url.includes(item.repositoryCommit) || !item.url.endsWith(item.path)) {
      violations.push(`${item.sourceId} URL binding is invalid`);
    }
    if (!Number.isInteger(item.bytes) || item.bytes <= 0) violations.push(`${item.sourceId} bytes are invalid`);
    if (!/^[0-9a-f]{64}$/.test(item.sha256)) violations.push(`${item.sourceId} SHA-256 is invalid`);
  }
  for (const conclusion of evidence.conclusions) {
    if (conclusion.classification !== "OFFICIAL_FACT") violations.push(`${conclusion.claimId} classification drifted`);
    for (const ref of conclusion.sourceRefs) {
      if (!sourceIdSet.has(ref)) violations.push(`${conclusion.claimId} has unknown sourceRef ${ref}`);
    }
  }
  if (evidence.limitations.length < 3) violations.push("evidence limitations are incomplete");
  return violations;
}

async function main() {
  const errors = [];
  const checks = [];
  function check(name, passed, detail) {
    const normalized = Boolean(passed);
    checks.push({ name, passed: normalized, detail });
    if (!normalized) errors.push(`${name}: ${detail}`);
  }

  const { profile, topology, targetBinding } = await loadSkeletonInputs(root);
  const [schema, edaManifest, evidence, topologyIdentity, bindingIdentity, manifestIdentity, evidenceIdentity] = await Promise.all([
    readJson(`${packageRoot}/profile.schema.json`),
    readJson(profile.sources.edaManifest.path),
    readJson(profile.sources.officialEvidence.path),
    fileIdentity(profile.sources.topology.path),
    fileIdentity(profile.sources.targetBinding.path),
    fileIdentity(profile.sources.edaManifest.path),
    fileIdentity(profile.sources.officialEvidence.path),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validateProfile = ajv.compile(schema);
  const schemaValid = validateProfile(profile);
  check("profile JSON Schema", schemaValid, schemaValid ? "valid" : ajv.errorsText(validateProfile.errors));
  check("topology file bytes", topologyIdentity.bytes === profile.sources.topology.bytes, `expected=${profile.sources.topology.bytes} actual=${topologyIdentity.bytes}`);
  check("topology file SHA-256", topologyIdentity.sha256 === profile.sources.topology.sha256, `expected=${profile.sources.topology.sha256} actual=${topologyIdentity.sha256}`);
  const canonicalTopologyHash = canonicalSha256(topologyHashInput(topology)).sha256;
  check("topology self hash", topology.topologyId === `hwt:sha256:${canonicalTopologyHash}`, topology.topologyId);
  check("profile topology identity", profile.sources.topology.topologyId === topology.topologyId, topology.topologyId);
  check("binding topology hash", targetBinding.topologyRef.sha256 === canonicalTopologyHash, targetBinding.topologyRef.sha256);
  check("binding topology path", path.resolve(root, targetBinding.topologyRef.path) === path.resolve(root, profile.sources.topology.path), targetBinding.topologyRef.path);
  check("target remains unresolved", targetBinding.targetIdentity.state === "UNRESOLVED", targetBinding.targetIdentity.state);
  check("EDA readiness is skeleton-only", targetBinding.eda.readiness === "SYSTEM_SKELETON_ONLY", targetBinding.eda.readiness);
  check("chip-level gate remains closed", targetBinding.eda.chipLevelReady === false, String(targetBinding.eda.chipLevelReady));
  const interfaceIds = topology.interfaces.map((item) => item.interfaceId);
  const bindingInterfaceIds = targetBinding.interfaceBindings.map((item) => item.interfaceId);
  check("18 interface bindings", targetBinding.interfaceBindings.length === 18, String(targetBinding.interfaceBindings.length));
  check("interface binding coverage", sameArray([...interfaceIds].sort(), [...bindingInterfaceIds].sort()), bindingInterfaceIds.join(" | "));
  check("interface evidence remains pending", targetBinding.interfaceBindings.every((item) => item.state === "TARGET_EVIDENCE_PENDING" && item.edaReadiness === "BLOCKED_TARGET_EVIDENCE"), "all interface target facts stay pending");
  check("EDA project remains unset", edaManifest.eda.projectName === "UNSET" && edaManifest.eda.projectRevision === "UNFROZEN", `${edaManifest.eda.projectName}/${edaManifest.eda.projectRevision}`);
  check("EDA bridge remains read-only", edaManifest.codexBridge.designWrite === false && edaManifest.codexBridge.rawExecution === false && edaManifest.codexBridge.ordering === false, JSON.stringify(edaManifest.codexBridge));
  check("EDA native artifact register remains empty", edaManifest.artifacts.length === 0, String(edaManifest.artifacts.length));

  const evidenceErrors = evidenceViolations(evidence, profile);
  check("official evidence contract", evidenceErrors.length === 0, evidenceErrors.join(" | ") || `${evidence.artifacts.length} pinned official artifacts`);

  const artifactSet = buildArtifactSet(profile, topology, targetBinding);
  const staleOutputs = await checkArtifactSet(root, artifactSet);
  check("generated artifacts are current", staleOutputs.length === 0, staleOutputs.join(" | ") || `${artifactSet.identities.length} byte-identical outputs`);
  const semanticErrors = validateModelSemantics({ profile, topology, targetBinding, edaManifest, artifactSet });
  check("model and negative-gate semantics", semanticErrors.length === 0, semanticErrors.join(" | ") || "12 blocks / 36 ports / 18 interfaces; target-specific implementation fields absent");
  const preview = await readFile(path.join(root, profile.outputs.preview), "utf8");
  const svgErrors = validateSvg(preview, artifactSet);
  check("SVG identity and element coverage", svgErrors.length === 0, svgErrors.join(" | ") || "12 block IDs, 18 interface IDs, 18 legend IDs; no executable or arrow marker content");
  check("write plan is unexecuted", artifactSet.writePlan.status === "UNEXECUTED" && Object.values(artifactSet.writePlan.executionIdentity).every((value) => value === null), JSON.stringify(artifactSet.writePlan.executionIdentity));
  check("native EDA outputs are absent by contract", artifactSet.writePlan.nativeSourceGenerated === false && artifactSet.writePlan.nativeExportGenerated === false, "source=false export=false");
  check("future EDA primitives are visual-only", artifactSet.writePlan.interfacePolicy.edaWireCount === 0 && artifactSet.writePlan.interfacePolicy.edaBusCount === 0 && sameArray(artifactSet.writePlan.interfacePolicy.allowedFuturePrimitiveKinds, ["RECTANGLE", "TEXT"]), JSON.stringify(artifactSet.writePlan.interfacePolicy));

  const outputIdentities = await Promise.all(artifactSet.identities.map((item) => fileIdentity(item.path)));
  for (const expected of artifactSet.identities) {
    const actual = outputIdentities.find((item) => item.path === expected.path);
    check(`artifact identity ${path.basename(expected.path)}`, actual.bytes === expected.bytes && actual.sha256 === expected.sha256, `${actual.bytes} bytes sha256=${actual.sha256}`);
  }

  const report = {
    schemaVersion: 1,
    profileId: profile.profileId,
    valid: errors.length === 0,
    summary: {
      passed: checks.filter((item) => item.passed).length,
      total: checks.length,
      blockCount: topology.blocks.length,
      logicalPortCount: topology.blocks.reduce((count, block) => count + block.ports.length, 0),
      interfaceCount: topology.interfaces.length,
      nativeSourceGenerated: false,
      nativeExportGenerated: false,
    },
    inputs: [topologyIdentity, bindingIdentity, manifestIdentity, evidenceIdentity],
    outputs: outputIdentities,
    checks,
    effects: profile.effects,
    remainingGates: [
      "BOARD_TARGET remains UNRESOLVED",
      "18 interface target bindings remain TARGET_EVIDENCE_PENDING",
      "connected scoped design-write window and native readback remain pending",
      "symbols, pins, physical network names, rail values, connectors and PCB layout remain locked",
    ],
    errors,
  };
  const reportPath = path.join(root, profile.outputs.validationReport);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `EDA system skeleton validation: ${report.summary.passed}/${report.summary.total}; ` +
      `${report.summary.blockCount} blocks, ${report.summary.logicalPortCount} ports, ${report.summary.interfaceCount} interfaces\n`,
  );
  process.stdout.write(`Report: ${profile.outputs.validationReport}\n`);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
