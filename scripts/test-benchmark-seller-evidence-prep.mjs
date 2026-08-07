import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const validatorPath = path.join(root, "scripts", "validate-benchmark-seller-evidence.mjs");
const preparerPath = path.join(root, "scripts", "prepare-benchmark-seller-evidence.mjs");
const profileId = "REF2-BABYBUS-G4-446637-SAME-ITEM-V1";
const recordId = `REF2-SELLER-EVIDENCE-SELFTEST-${process.pid}`;
const workspaceRoot = path.join(root, "build", "benchmark-seller-evidence", recordId);
const testRoot = path.join(root, "build", `benchmark-seller-evidence-selftest-${process.pid}`);
const purchasePlanPath = path.join(root, "hardware", "evt0", "purchase-plan.csv");
const targetBindingPath = path.join(root, "hardware", "evt0", "hardware-system-v1", "target-binding.json");
const results = [];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function recordResult(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail });
}

function runNode(script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
  });
}

async function writeArtifact(fileName, content, kind, provenance, mediaType) {
  const file = path.join(workspaceRoot, "raw", fileName);
  const bytes = Buffer.from(content, "utf8");
  await writeFile(file, bytes);
  return {
    id: fileName.replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_|_$/gu, "").toUpperCase(),
    kind,
    provenance,
    path: relative(file),
    bytes: bytes.length,
    sha256: sha256(bytes),
    mediaType,
    capturedAt: "2026-08-04T06:30:00+08:00",
    sourceUrl: "https://seller.example.invalid/thread/REF2-SYNTHETIC",
  };
}

async function validateCase(caseName, document, expectedSuccess) {
  const caseRoot = path.join(testRoot, caseName);
  const recordDirectory = path.join(caseRoot, "records");
  await mkdir(recordDirectory, { recursive: true });
  await writeFile(path.join(recordDirectory, `${document.recordId}.json`), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  const result = runNode(validatorPath, [], {
    BENCHMARK_SELLER_EVIDENCE_RECORDS_DIR: relative(recordDirectory),
    BENCHMARK_SELLER_EVIDENCE_REPORT_PATH: relative(path.join(caseRoot, "report.json")),
  });
  const succeeded = result.status === 0;
  recordResult(caseName, succeeded === expectedSuccess, `exit=${result.status}; expectedSuccess=${expectedSuccess}`);
}

await rm(workspaceRoot, { recursive: true, force: true });
await rm(testRoot, { recursive: true, force: true });

const protectedBefore = {
  purchasePlan: sha256(await readFile(purchasePlanPath)),
  targetBinding: sha256(await readFile(targetBindingPath)),
};

try {
  const prepare = runNode(preparerPath, ["--profile-id", profileId, "--record-id", recordId]);
  if (prepare.status !== 0) {
    throw new Error(`Preparer failed: ${prepare.stderr || prepare.stdout}`);
  }

  const [draft, manifest, requestBytes] = await Promise.all([
    readFile(path.join(workspaceRoot, "record.draft.json"), "utf8").then(JSON.parse),
    readFile(path.join(workspaceRoot, "source-manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(workspaceRoot, "SELLER-REQUEST.txt")),
  ]);

  const prepPending = draft.recordId === recordId &&
    draft.profileId === profileId &&
    draft.request.state === "PREPARED_NOT_SENT" &&
    draft.response.state === "PENDING" &&
    draft.rawArtifacts.length === 0 &&
    draft.requirementResults.length === 11 &&
    draft.requirementResults.every((result) => result.status === "PENDING") &&
    draft.decision.status === "EVIDENCE_REQUIRED" &&
    draft.requestTemplate.bytes === requestBytes.length &&
    draft.requestTemplate.sha256 === sha256(requestBytes);
  recordResult("pending preparation contract", prepPending, `requirements=${draft.requirementResults.length}; raw=${draft.rawArtifacts.length}`);

  let sourceHashesValid = manifest.sourceFiles.length >= 7;
  for (const source of manifest.sourceFiles) {
    const bytes = await readFile(path.join(root, source.path));
    sourceHashesValid = sourceHashesValid && bytes.length === source.bytes && sha256(bytes) === source.sha256;
  }
  const protectedAfter = {
    purchasePlan: sha256(await readFile(purchasePlanPath)),
    targetBinding: sha256(await readFile(targetBindingPath)),
  };
  const sourceBoundary = sourceHashesValid &&
    manifest.status === "PREPARED_NOT_SENT" &&
    manifest.targetBindingEffect === "NONE_BENCHMARK_ONLY" &&
    manifest.purchaseAuthorizationEffect === "NONE_HUMAN_DECISION_REQUIRED" &&
    manifest.intakeEffect === "NONE_UNTIL_RECEIVED_UNIT" &&
    protectedBefore.purchasePlan === protectedAfter.purchasePlan &&
    protectedBefore.targetBinding === protectedAfter.targetBinding;
  recordResult("source hashes and protected-state boundary", sourceBoundary, `sources=${manifest.sourceFiles.length}`);

  const duplicate = runNode(preparerPath, ["--profile-id", profileId, "--record-id", recordId]);
  recordResult("duplicate workspace rejected", duplicate.status !== 0, `exit=${duplicate.status}`);

  const artifacts = [
    await writeArtifact("request-export.txt", `${recordId}: request export`, "REQUEST_EXPORT", "PLATFORM_EXPORT", "text/plain"),
    await writeArtifact("seller-chat-export.txt", `${recordId}: seller confirms same pending item and no substitution`, "SELLER_CHAT_EXPORT", "PLATFORM_EXPORT", "text/plain"),
    await writeArtifact("order-page.html", `${recordId}: order 446637 / seller SKU 446637 / 32GB`, "ORDER_PAGE_CAPTURE", "PLATFORM_EXPORT", "text/html"),
    await writeArtifact("package-photo.jpg", `${recordId}: synthetic G4 package six sides barcode BARCODE-001 lot LOT-001`, "PACKAGE_PHOTO", "SELLER_ORIGINAL", "image/jpeg"),
    await writeArtifact("pen-label.jpg", `${recordId}: synthetic G4 pen label SN SYN-PREFIX-0001-SUFFIX`, "PEN_LABEL_PHOTO", "SELLER_ORIGINAL", "image/jpeg"),
    await writeArtifact("boot-version.jpg", `${recordId}: synthetic boot model G4 display version DISPLAY-1`, "BOOT_VERSION_PHOTO", "SELLER_ORIGINAL", "image/jpeg"),
    await writeArtifact("bundle-photo.jpg", `${recordId}: synthetic 32GB bundle book stickers cable manual`, "BUNDLE_PHOTO", "SELLER_ORIGINAL", "image/jpeg"),
    await writeArtifact("continuous-binding.mp4", `${recordId}: synthetic continuous order-package-open-label-boot-bundle sequence`, "SELLER_ORIGINAL_VIDEO", "SELLER_ORIGINAL", "video/mp4"),
  ];
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact.id]));
  const complete = structuredClone(draft);
  const preparedMs = Date.parse(draft.preparedAt);
  const sentAt = new Date(preparedMs + 1000).toISOString();
  const receivedAt = new Date(preparedMs + 2000).toISOString();
  const reviewedAt = new Date(preparedMs + 3000).toISOString();
  complete.observedIdentity = {
    listingUrl: "https://seller.example.invalid/product/446637",
    sellerOrderSku: "446637",
    skuRelation: "Seller order SKU 446637 maps to source order SKU 446637",
    sellerName: "SYNTHETIC_SELLER",
    fulfilmentParty: "SYNTHETIC_FULFILMENT",
    stockStatement: "SYNTHETIC_PENDING_ITEM_RESERVED",
    productGeneration: "G4",
    packageBarcode: "SYNTHETIC-BARCODE-001",
    productionLotOrDate: "SYNTHETIC-LOT-001",
    deviceModel: "SYNTHETIC-G4",
    serialPrefix: "SYN-PREFIX",
    serialSuffix: "SUFFIX",
    bootVersionDisplay: "DISPLAY-1",
    bundleCapacityLabel: "32GB",
    includedReadableMedia: ["SYNTHETIC_BOOK", "SYNTHETIC_RECORDING_STICKERS"],
  };
  complete.request = {
    state: "SENT",
    sentAt,
    channel: "MARKETPLACE_CHAT",
    sellerEndpoint: "https://seller.example.invalid/thread/REF2-SYNTHETIC",
    transportReference: "SYNTHETIC-REQUEST-001",
    artifactRefs: [byKind.get("REQUEST_EXPORT")],
  };
  complete.response = {
    state: "RECEIVED",
    receivedAt,
    senderIdentity: "SYNTHETIC_SELLER_ACCOUNT",
    artifactRefs: artifacts.filter((artifact) => artifact.kind !== "REQUEST_EXPORT").map((artifact) => artifact.id),
  };
  complete.rawArtifacts = artifacts;
  const refsByRequirement = {
    SELLER_LISTING_AND_FULFILLMENT: [byKind.get("ORDER_PAGE_CAPTURE")],
    PACKAGE_SIX_SIDES: [byKind.get("PACKAGE_PHOTO"), byKind.get("SELLER_ORIGINAL_VIDEO")],
    PACKAGE_BARCODE_AND_LOT: [byKind.get("PACKAGE_PHOTO")],
    PEN_NAMEPLATE_AND_SERIAL: [byKind.get("PEN_LABEL_PHOTO")],
    BOOT_MODEL_AND_FIRMWARE: [byKind.get("BOOT_VERSION_PHOTO")],
    INCLUDED_READABLE_MEDIA: [byKind.get("BUNDLE_PHOTO")],
    NO_SUBSTITUTION_CONFIRMATION: [byKind.get("SELLER_CHAT_EXPORT")],
    SAME_ITEM_CONTINUOUS_BINDING: [byKind.get("SELLER_ORIGINAL_VIDEO")],
    REF2_G4_VISIBLE: [byKind.get("PACKAGE_PHOTO"), byKind.get("PEN_LABEL_PHOTO")],
    REF2_446637_MAPPING: [byKind.get("ORDER_PAGE_CAPTURE"), byKind.get("SELLER_CHAT_EXPORT")],
    REF2_32GB_BUNDLE_BINDING: [byKind.get("BUNDLE_PHOTO"), byKind.get("ORDER_PAGE_CAPTURE")],
  };
  complete.requirementResults = complete.requirementResults.map((result) => ({
    id: result.id,
    status: "PASS",
    observedValue: `SYNTHETIC_PASS_${result.id}`,
    artifactRefs: refsByRequirement[result.id],
    notes: "Synthetic validator vector only",
  }));
  complete.review = {
    reviewedAt,
    reviewer: "SYNTHETIC_REVIEWER",
    notes: "Synthetic complete vector; no product or payment fact",
  };
  complete.decision = {
    status: "EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW",
    reason: "Synthetic complete vector for validator self-test only.",
    blockers: [],
  };

  await validateCase("positive-complete", complete, true);

  const statusOnly = structuredClone(complete);
  statusOnly.requirementResults.find((result) => result.id === "SAME_ITEM_CONTINUOUS_BINDING").status = "PENDING";
  statusOnly.requirementResults.find((result) => result.id === "SAME_ITEM_CONTINUOUS_BINDING").observedValue = null;
  statusOnly.requirementResults.find((result) => result.id === "SAME_ITEM_CONTINUOUS_BINDING").artifactRefs = [];
  await validateCase("negative-status-only", statusOnly, false);

  const crossRecord = structuredClone(complete);
  crossRecord.recordId = `${recordId}-CROSS`;
  await validateCase("negative-cross-record-path", crossRecord, false);

  const tampered = structuredClone(complete);
  tampered.rawArtifacts[3].sha256 = "0".repeat(64);
  await validateCase("negative-tampered-hash", tampered, false);

  const promotedEffect = structuredClone(complete);
  promotedEffect.targetBindingEffect = "TARGET_CHANGED";
  await validateCase("negative-effect-promotion", promotedEffect, false);

  const futureTimeline = structuredClone(complete);
  futureTimeline.review.reviewedAt = "2099-01-01T00:00:00Z";
  await validateCase("negative-future-timeline", futureTimeline, false);
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(testRoot, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.passed);
console.log(`Benchmark Seller Evidence prep/self-test: ${results.length - failed.length}/${results.length} passed`);
for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
if (failed.length > 0) {
  process.exitCode = 1;
}
