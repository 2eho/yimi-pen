import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256 } from "./snapshot-jcs.mjs";

const root = process.cwd();
const contractRoot = path.join(root, "hardware/evt0/hardware-system-v1");
const topologyPath = path.join(contractRoot, "topology.json");
const bindingPath = path.join(contractRoot, "target-binding.json");
const reportPath = path.join(root, "build/hardware-system-validation.json");
const errors = [];
const checks = [];

function check(name, passed, detail) {
  const normalized = Boolean(passed);
  checks.push({ name, passed: normalized, detail });
  if (!normalized) errors.push(`${name}: ${detail}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function unique(values) {
  return new Set(values).size === values.length;
}

function topologyHashInput(topology) {
  const { topologyId: _topologyId, ...hashInput } = topology;
  return hashInput;
}

function collectRequirementIds(text) {
  return new Set(text.match(/\b(?:RQ-SP|PS)-[0-9]{3}\b/g) ?? []);
}

function ownKeysOnly(object, allowedKeys) {
  return Object.keys(object).every((key) => allowedKeys.has(key));
}

const [topologySchema, bindingSchema, topology, binding] = await Promise.all([
  readJson(path.join(contractRoot, "topology.schema.json")),
  readJson(path.join(contractRoot, "target-binding.schema.json")),
  readJson(topologyPath),
  readJson(bindingPath),
]);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});
const validateTopology = ajv.compile(topologySchema);
const validateBinding = ajv.compile(bindingSchema);

const topologySchemaValid = validateTopology(topology);
check(
  "topology JSON Schema",
  topologySchemaValid,
  topologySchemaValid ? "valid" : ajv.errorsText(validateTopology.errors),
);
const bindingSchemaValid = validateBinding(binding);
check(
  "target binding JSON Schema",
  bindingSchemaValid,
  bindingSchemaValid ? "valid" : ajv.errorsText(validateBinding.errors),
);

const topologySha256 = canonicalSha256(topologyHashInput(topology)).sha256;
check(
  "topology self hash",
  topology.topologyId === `hwt:sha256:${topologySha256}`,
  `expected=hwt:sha256:${topologySha256} actual=${topology.topologyId}`,
);
check(
  "target binding topology hash",
  binding.topologyRef?.sha256 === topologySha256,
  `expected=${topologySha256} actual=${binding.topologyRef?.sha256}`,
);
check(
  "target binding topology path",
  path.resolve(root, binding.topologyRef?.path ?? "") === topologyPath,
  String(binding.topologyRef?.path),
);

const blockIds = (topology.blocks ?? []).map((block) => block.blockId);
const blockRoles = (topology.blocks ?? []).map((block) => block.role);
check("unique block IDs", unique(blockIds), blockIds.join(" | "));
check("unique block roles", unique(blockRoles), blockRoles.join(" | "));

const blockById = new Map();
const portByEndpoint = new Map();
for (const block of topology.blocks ?? []) {
  blockById.set(block.blockId, block);
  const portIds = (block.ports ?? []).map((port) => port.portId);
  check(`unique ports ${block.blockId}`, unique(portIds), portIds.join(" | "));
  for (const port of block.ports ?? []) {
    portByEndpoint.set(`${block.blockId}/${port.portId}`, port);
  }
}

const topologyRequirementIds = new Set(topology.requirements ?? []);
const interfaceIds = (topology.interfaces ?? []).map((item) => item.interfaceId);
check("unique interface IDs", unique(interfaceIds), interfaceIds.join(" | "));

const endpointUse = new Map();
for (const item of topology.interfaces ?? []) {
  const fromKey = `${item.from?.blockId}/${item.from?.portId}`;
  const toKey = `${item.to?.blockId}/${item.to?.portId}`;
  const fromPort = portByEndpoint.get(fromKey);
  const toPort = portByEndpoint.get(toKey);
  check(`${item.interfaceId} from endpoint`, Boolean(fromPort), fromKey);
  check(`${item.interfaceId} to endpoint`, Boolean(toPort), toKey);
  check(`${item.interfaceId} distinct blocks`, item.from?.blockId !== item.to?.blockId, `${item.from?.blockId} -> ${item.to?.blockId}`);
  if (fromPort) {
    check(
      `${item.interfaceId} from direction`,
      ["PRODUCES", "BIDIRECTIONAL", "PASSIVE"].includes(fromPort.direction),
      `${fromKey} direction=${fromPort.direction}`,
    );
    endpointUse.set(fromKey, (endpointUse.get(fromKey) ?? 0) + 1);
  }
  if (toPort) {
    check(
      `${item.interfaceId} to direction`,
      ["CONSUMES", "BIDIRECTIONAL", "PASSIVE"].includes(toPort.direction),
      `${toKey} direction=${toPort.direction}`,
    );
    endpointUse.set(toKey, (endpointUse.get(toKey) ?? 0) + 1);
  }
  if (fromPort && toPort) {
    check(
      `${item.interfaceId} endpoint semantics`,
      fromPort.semantic === toPort.semantic,
      `${JSON.stringify(fromPort.semantic)} -> ${JSON.stringify(toPort.semantic)}`,
    );
  }
  for (const requirementId of item.requirements ?? []) {
    check(
      `${item.interfaceId} requirement declared by topology`,
      topologyRequirementIds.has(requirementId),
      requirementId,
    );
  }
}
for (const endpointKey of portByEndpoint.keys()) {
  check(
    `port is bound ${endpointKey}`,
    endpointUse.get(endpointKey) === 1,
    `interface endpoint uses=${endpointUse.get(endpointKey) ?? 0}`,
  );
}

const [productSlice, productTask, releaseGateCatalog] = await Promise.all([
  readFile(path.join(root, "docs/product-slice-evt0.md"), "utf8"),
  readFile(path.join(root, "docs/codex/tasks/system-product-rd/active-task.md"), "utf8"),
  readJson(path.join(root, "hardware/evt0/release-gates-v1/catalog.json")),
]);
const ownedRequirementIds = new Set([
  ...collectRequirementIds(productSlice),
  ...collectRequirementIds(productTask),
]);
for (const requirementId of topologyRequirementIds) {
  check(
    `requirement exists ${requirementId}`,
    ownedRequirementIds.has(requirementId),
    "missing from product-slice or system-product-rd owner",
  );
}

const selector = binding.targetIdentity?.intakeSelector;
const selectorKeys = new Set([
  "templatePath",
  "recordsDirectory",
  "intakeKind",
  "purchasePlanItemId",
  "candidateId",
  "requiredDisposition",
  "minimumMatchingSamples",
]);
check(
  "target identity is selector/evidence-map only",
  ownKeysOnly(binding.targetIdentity ?? {}, new Set(["state", "intakeSelector", "observationRefs", "testRefs", "releaseGateRefs"])) &&
    ownKeysOnly(selector ?? {}, selectorKeys),
  `targetIdentity keys=${Object.keys(binding.targetIdentity ?? {}).join("|")}`,
);

const intakeTemplatePath = path.resolve(root, selector?.templatePath ?? "");
const intakeTemplate = await readJson(intakeTemplatePath);
check("intake selector kind", intakeTemplate.intakeKind === selector?.intakeKind, `${intakeTemplate.intakeKind} vs ${selector?.intakeKind}`);
check(
  "intake selector purchase item",
  intakeTemplate.identity?.purchasePlanItemId === selector?.purchasePlanItemId,
  `${intakeTemplate.identity?.purchasePlanItemId} vs ${selector?.purchasePlanItemId}`,
);
check(
  "intake selector candidate",
  intakeTemplate.identity?.candidateId === selector?.candidateId,
  `${intakeTemplate.identity?.candidateId} vs ${selector?.candidateId}`,
);
const intakeObservationIds = new Set(Object.keys(intakeTemplate.observations ?? {}));
const intakeTestIds = new Set((intakeTemplate.tests ?? []).map((test) => test.id));
const releaseGateIds = new Set((releaseGateCatalog.gates ?? []).map((gate) => gate.gateId));

for (const observationId of binding.targetIdentity?.observationRefs ?? []) {
  check(`target identity observation exists ${observationId}`, intakeObservationIds.has(observationId), "missing from board/OID intake observation catalog");
}
for (const testId of binding.targetIdentity?.testRefs ?? []) {
  check(`target identity test exists ${testId}`, intakeTestIds.has(testId), "missing from board/OID intake test catalog");
}

const bindingInterfaceIds = (binding.interfaceBindings ?? []).map((item) => item.interfaceId);
check("unique binding interface IDs", unique(bindingInterfaceIds), bindingInterfaceIds.join(" | "));
const missingBindings = interfaceIds.filter((id) => !bindingInterfaceIds.includes(id));
const extraBindings = bindingInterfaceIds.filter((id) => !interfaceIds.includes(id));
check(
  "binding covers topology interfaces exactly",
  missingBindings.length === 0 && extraBindings.length === 0 && bindingInterfaceIds.length === interfaceIds.length,
  `missing=${missingBindings.join("|") || "none"} extra=${extraBindings.join("|") || "none"}`,
);

for (const item of binding.interfaceBindings ?? []) {
  for (const observationId of item.observationRefs ?? []) {
    check(
      `${item.interfaceId} observation exists ${observationId}`,
      intakeObservationIds.has(observationId),
      "missing from board/OID intake observation catalog",
    );
  }
  for (const testId of item.testRefs ?? []) {
    check(
      `${item.interfaceId} intake test exists ${testId}`,
      intakeTestIds.has(testId),
      "missing from board/OID intake test catalog",
    );
  }
  for (const gateId of item.releaseGateRefs ?? []) {
    check(
      `${item.interfaceId} release gate exists ${gateId}`,
      releaseGateIds.has(gateId),
      "missing from ReleaseGateCatalog v1",
    );
  }
}
const mappedObservationIds = new Set([
  ...(binding.targetIdentity?.observationRefs ?? []),
  ...(binding.interfaceBindings ?? []).flatMap((item) => item.observationRefs ?? []),
]);
const mappedTestIds = new Set([
  ...(binding.targetIdentity?.testRefs ?? []),
  ...(binding.interfaceBindings ?? []).flatMap((item) => item.testRefs ?? []),
]);
const unmappedObservationIds = [...intakeObservationIds].filter((id) => !mappedObservationIds.has(id));
const unmappedTestIds = [...intakeTestIds].filter((id) => !mappedTestIds.has(id));
check("all board intake observations have an impact owner", unmappedObservationIds.length === 0, `unmapped=${unmappedObservationIds.join("|") || "none"}`);
check("all board intake tests have an impact owner", unmappedTestIds.length === 0, `unmapped=${unmappedTestIds.join("|") || "none"}`);
for (const gateId of binding.targetIdentity?.releaseGateRefs ?? []) {
  check(`target identity release gate exists ${gateId}`, releaseGateIds.has(gateId), "missing from ReleaseGateCatalog v1");
}
for (const gateId of binding.eda?.entryGateRefs ?? []) {
  check(`EDA entry gate exists ${gateId}`, releaseGateIds.has(gateId), "missing from ReleaseGateCatalog v1");
}

let recordNames = [];
try {
  recordNames = (await readdir(path.resolve(root, selector?.recordsDirectory ?? "")))
    .filter((name) => name.endsWith(".json"))
    .sort();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const acceptedRecords = [];
for (const recordName of recordNames) {
  const record = await readJson(path.join(root, selector.recordsDirectory, recordName));
  const matches = record.intakeKind === selector.intakeKind &&
    record.identity?.purchasePlanItemId === selector.purchasePlanItemId &&
    record.identity?.candidateId === selector.candidateId &&
    record.disposition?.status === selector.requiredDisposition &&
    Array.isArray(record.identity?.samples) &&
    record.identity.samples.length >= selector.minimumMatchingSamples;
  if (matches) acceptedRecords.push(recordName);
}
const expectedTargetState = acceptedRecords.length > 0 ? "FROZEN" : "UNRESOLVED";
check(
  "target state follows accepted intake",
  binding.targetIdentity?.state === expectedTargetState,
  `accepted=${acceptedRecords.join("|") || "none"} expected=${expectedTargetState} actual=${binding.targetIdentity?.state}`,
);

if (binding.targetIdentity?.state === "UNRESOLVED") {
  check("unresolved target blocks chip-level EDA", binding.eda?.chipLevelReady === false, `chipLevelReady=${binding.eda?.chipLevelReady}`);
  check("unresolved target limits EDA to system skeleton", binding.eda?.readiness === "SYSTEM_SKELETON_ONLY", `readiness=${binding.eda?.readiness}`);
  check(
    "unresolved interfaces are not target-frozen",
    (binding.interfaceBindings ?? []).every((item) => item.state !== "TARGET_FROZEN"),
    "a target-frozen interface was found",
  );
  check(
    "unresolved interfaces are not chip-level ready",
    (binding.interfaceBindings ?? []).every((item) => item.edaReadiness !== "CHIP_LEVEL_READY"),
    "a chip-level-ready interface was found",
  );
}

const unresolvedGlobalProbe = structuredClone(binding);
unresolvedGlobalProbe.targetIdentity.state = "UNRESOLVED";
unresolvedGlobalProbe.eda.readiness = "CHIP_LEVEL_READY";
unresolvedGlobalProbe.eda.chipLevelReady = true;
check(
  "schema rejects unresolved global chip-level readiness",
  !validateBinding(unresolvedGlobalProbe),
  "unresolved target accepted chip-level EDA readiness",
);
const unresolvedInterfaceProbe = structuredClone(binding);
unresolvedInterfaceProbe.targetIdentity.state = "UNRESOLVED";
unresolvedInterfaceProbe.interfaceBindings[0].edaReadiness = "CHIP_LEVEL_READY";
check(
  "schema rejects unresolved interface chip-level readiness",
  !validateBinding(unresolvedInterfaceProbe),
  "unresolved interface accepted chip-level EDA readiness",
);

const prematureChipLevelProbe = structuredClone(binding);
prematureChipLevelProbe.targetIdentity.state = "FROZEN";
prematureChipLevelProbe.eda.readiness = "CHIP_LEVEL_READY";
prematureChipLevelProbe.eda.chipLevelReady = true;
prematureChipLevelProbe.eda.blockedWork = [];
check(
  "schema rejects global chip-level readiness while interfaces are pending",
  !validateBinding(prematureChipLevelProbe),
  "pending interface evidence accepted global chip-level EDA readiness",
);

const frozenInterfaceProbe = structuredClone(binding.interfaceBindings[0]);
frozenInterfaceProbe.state = "TARGET_FROZEN";
frozenInterfaceProbe.edaReadiness = "BLOCKED_TARGET_EVIDENCE";
frozenInterfaceProbe.blocker = null;
const interfaceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $ref: `${bindingSchema.$id}#/$defs/interfaceBinding`,
};
const isolatedAjv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
isolatedAjv.addSchema(bindingSchema);
const validateInterfaceBinding = isolatedAjv.compile(interfaceSchema);
check(
  "schema couples target-frozen interface to chip-level readiness",
  !validateInterfaceBinding(frozenInterfaceProbe),
  "target-frozen interface retained blocked EDA readiness",
);

const passed = checks.filter((item) => item.passed).length;
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 1,
  profile: "hardware-system-validation-v1",
  valid: errors.length === 0,
  topologyId: topology.topologyId,
  topologySha256,
  targetState: binding.targetIdentity?.state,
  interfaceBindings: bindingInterfaceIds.length,
  topologyInterfaces: interfaceIds.length,
  checks,
}, null, 2)}\n`, "utf8");
console.log(`HardwareSystem v1 valid: ${errors.length === 0}`);
console.log(`Checks: ${passed}/${checks.length} passed`);
console.log(`Topology SHA-256: ${topologySha256}`);
console.log(`Target state: ${binding.targetIdentity?.state}`);
console.log(`Interface bindings: ${bindingInterfaceIds.length}/${interfaceIds.length}`);
console.log(`Report: ${reportPath}`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
