import { createHash } from "node:crypto";
import { createEvidenceReceipt } from "../../contracts/release-gates-v1.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function jsonPointer(value, pointer) {
  if (pointer === "") return value;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) throw new Error(`invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").reduce((current, token) => {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current)) {
      throw new Error(`JSON pointer does not exist: ${pointer}`);
    }
    return current[key];
  }, value);
}

export function reportConditionsPass(report, conditions) {
  return conditions.every((condition) => {
    const actual = jsonPointer(report, condition.pointer);
    if (condition.operator === "equals") return JSON.stringify(actual) === JSON.stringify(condition.expected);
    if (condition.operator === "equalsPointer") {
      return JSON.stringify(actual) === JSON.stringify(jsonPointer(report, condition.expected));
    }
    if (condition.operator === "allTrue") {
      return actual !== null
        && typeof actual === "object"
        && !Array.isArray(actual)
        && Object.keys(actual).length > 0
        && Object.values(actual).every((value) => value === true);
    }
    throw new Error(`unknown report condition operator: ${condition.operator}`);
  });
}

export function receiptFromHostReport({ catalog, adapter, reportBytes, releaseSubject, executedAt }) {
  const report = JSON.parse(Buffer.from(reportBytes).toString("utf8"));
  if (adapter.expectedProfile !== null && report.profile !== adapter.expectedProfile) {
    throw new Error(`${adapter.reportPath} profile differs from adapter contract`);
  }
  const declaredCatalogIds = [
    report.releaseGateCatalogId,
    report.catalogId,
    report.catalog?.catalogId,
    report.gates?.releaseGateCatalogId,
  ]
    .filter((value) => value !== undefined);
  if (declaredCatalogIds.some((value) => value !== catalog.catalogId)) {
    throw new Error(`${adapter.reportPath} was produced against a different ReleaseGateCatalog`);
  }
  const reportSha256 = sha256(reportBytes);
  const passed = reportConditionsPass(report, adapter.passConditions);
  const subjectSuffix = adapter.producerId.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "-");
  return createEvidenceReceipt({
    catalog,
    gateId: adapter.gateId,
    releaseSubject,
    evidenceSubject: {
      subjectType: "HOST_REPORT",
      subjectId: `HOST-REPORT-${subjectSuffix}`,
      subjectRevisionSha256: reportSha256,
    },
    producer: {
      producerId: adapter.producerId,
      producerVersion: adapter.producerVersion,
    },
    executedAt,
    result: passed ? "PASS" : "FAIL",
    evidenceClass: "host",
    syntheticEvidence: adapter.syntheticEvidence,
    artifacts: [{
      role: "host-report",
      path: adapter.reportPath,
      size: reportBytes.length,
      sha256: reportSha256,
    }],
    claimRefs: adapter.claimRefs,
    diagnostic: passed ? null : { reasonCode: "HOST_REPORT_CONDITION_FAILED" },
  });
}

export async function verifyReceiptArtifacts({ receipt, artifactReader, requireHardwarePrefix = false }) {
  for (const artifact of receipt.artifacts) {
    if (requireHardwarePrefix && !artifact.path.startsWith("hardware/evt0/")) {
      throw new Error(`physical/production artifact is not persisted under hardware/evt0: ${artifact.path}`);
    }
    const bytes = Buffer.from(await artifactReader(artifact.path));
    if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) {
      throw new Error(`artifact bytes differ from receipt: ${artifact.path}`);
    }
  }
  return receipt;
}
