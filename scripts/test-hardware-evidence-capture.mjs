import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureEvidence,
  checkCapture,
  preflightWorkspace,
} from "./capture-hardware-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ROOT = path.join(ROOT, "build", "hardware-evidence-capture-selftest", randomUUID());
const REPORT_PATH = path.join(ROOT, "build", "hardware-evidence-capture-selftest.json");
const checks = [];

function check(name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) throw new Error(`${name}: ${detail ?? "failed"}`);
}

async function expectReject(name, operation, pattern) {
  let message = null;
  try {
    await operation();
  } catch (error) {
    message = error.message;
  }
  check(name, typeof message === "string" && pattern.test(message), message);
}

function requestEffects() {
  return {
    targetBindingEffect: "NONE",
    bomRevisionEffect: "NONE",
    releaseGateEffect: "NONE",
    purchaseAuthorizationEffect: "NONE",
    recordStateEffect: "NONE_OWNER_RECORD_UNCHANGED",
  };
}

function laneFixture(lane, identity) {
  if (lane === "VENDOR_CONTACT") {
    return {
      workspaceRoot: `build/vendor-contact-receipts/${identity}`,
      ownerFile: "receipt.draft.json",
      owner: { schemaVersion: 1, recordKind: "vendor-outbound-send-receipt", receiptId: identity },
    };
  }
  if (lane === "BENCHMARK_SELLER") {
    return {
      workspaceRoot: `build/benchmark-seller-evidence/${identity}`,
      ownerFile: "record.draft.json",
      owner: { schemaVersion: 1, recordKind: "benchmark-seller-evidence", recordId: identity },
    };
  }
  if (lane === "LAB_REGISTRY") {
    return {
      workspaceRoot: `build/hardware-lab/instruments/${identity}`,
      ownerFile: "registry.draft.json",
      owner: {
        schemaVersion: 1,
        recordKind: "evt0-lab-instrument-registry",
        registryId: identity,
        instruments: [
          { id: "DMM-01", assets: [{ assetId: "DMM-01-MULTIMETER" }] },
          { id: "PSU-01", assets: [{ assetId: "PSU-01-BENCH-SUPPLY" }] },
        ],
      },
    };
  }
  if (lane === "VENDOR_RESPONSE") {
    return {
      workspaceRoot: `build/vendor-evidence/CANDIDATE-A/${identity}`,
      ownerFile: "response.draft.json",
      owner: {
        schemaVersion: 1,
        recordKind: "mb1-prepay-response",
        responseId: identity,
        candidateId: "CANDIDATE-A",
        identityTuple: {
          BOARD_MPN: {},
          PCB_REV: {},
          HEAD_MPN: {},
          HEAD_REV: {},
          FW_VERSION: {},
        },
        answers: Array.from({ length: 8 }, (_, index) => ({ id: `M0${index + 1}` })),
        attachments: Array.from({ length: 10 }, (_, index) => ({ id: `A${String(index + 1).padStart(2, "0")}` })),
        sampleOffers: [{ sampleId: "SAMPLE-A" }, { sampleId: "SAMPLE-B" }],
      },
    };
  }
  throw new Error(`unknown lane fixture: ${lane}`);
}

function routeFor(lane, overrides = {}) {
  if (lane === "VENDOR_CONTACT") return { kind: "vendor-contact-route-v1", role: "SUBMISSION_EXPORT", ...overrides };
  if (lane === "BENCHMARK_SELLER") {
    return {
      kind: "benchmark-seller-route-v1",
      artifactKind: "SELLER_CHAT_EXPORT",
      provenance: "PLATFORM_EXPORT",
      ...overrides,
    };
  }
  if (lane === "LAB_REGISTRY") {
    return {
      kind: "lab-registry-route-v1",
      instrumentId: "DMM-01",
      assetId: "DMM-01-MULTIMETER",
      role: "IDENTITY",
      ...overrides,
    };
  }
  return {
    kind: "vendor-response-route-v1",
    role: "ANSWER",
    referenceIds: ["M01"],
    ...overrides,
  };
}

async function createFixture({
  lane,
  identity,
  captureId,
  artifacts = null,
  ownerMutator = null,
  requestMutator = null,
}) {
  const fixture = laneFixture(lane, identity);
  const workspaceAbsolute = path.join(RUN_ROOT, ...fixture.workspaceRoot.split("/"));
  const rawAbsolute = path.join(workspaceAbsolute, "raw");
  await mkdir(rawAbsolute, { recursive: true });
  const owner = structuredClone(fixture.owner);
  if (ownerMutator) ownerMutator(owner);
  const ownerPath = path.join(workspaceAbsolute, fixture.ownerFile);
  await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  const sourceRoot = path.join(workspaceAbsolute, "incoming", captureId);
  await mkdir(sourceRoot, { recursive: true });
  const artifactSpecs = artifacts ?? [
    { id: `${captureId}-A`, destinationName: `${captureId.toLowerCase()}-a.txt`, content: `fixture:${captureId}:A\n` },
  ];
  const requestArtifacts = [];
  for (const [index, artifact] of artifactSpecs.entries()) {
    const sourcePath = path.join(sourceRoot, `source-${index}.txt`);
    await writeFile(sourcePath, artifact.content ?? `fixture:${captureId}:${index}\n`, "utf8");
    requestArtifacts.push({
      id: artifact.id,
      sourcePath: `incoming/${captureId}/source-${index}.txt`,
      destinationName: artifact.destinationName,
      mediaType: artifact.mediaType ?? "text/plain",
      capturedAt: artifact.capturedAt ?? "2026-08-04T12:30:00+08:00",
      sourceUrl: artifact.sourceUrl ?? null,
      route: artifact.route ?? routeFor(lane),
    });
  }
  const request = {
    schemaVersion: 1,
    requestKind: "hardware-raw-evidence-capture",
    captureId,
    lane,
    workspaceRoot: fixture.workspaceRoot,
    preparedAt: "2026-08-04T12:31:00+08:00",
    artifacts: requestArtifacts,
    effects: requestEffects(),
  };
  if (requestMutator) requestMutator(request);
  const requestRelative = `${fixture.workspaceRoot}/capture-request.${captureId}.json`;
  const requestPath = path.join(RUN_ROOT, ...requestRelative.split("/"));
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return {
    ...fixture,
    workspaceAbsolute,
    rawAbsolute,
    ownerPath,
    request,
    requestPath,
    requestRelative,
    sourceRoot,
  };
}

async function fileExists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function run() {
  await mkdir(RUN_ROOT, { recursive: true });
  await cp(
    path.join(ROOT, "hardware", "evt0", "evidence-capture-v1"),
    path.join(RUN_ROOT, "hardware", "evt0", "evidence-capture-v1"),
    { recursive: true },
  );

  const contact = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-RECEIPT-01",
    captureId: "CONTACT-CAPTURE-01",
    artifacts: [
      { id: "CONTACT-OFFICIAL", destinationName: "official-entry.html", content: "<html>official</html>\n", mediaType: "text/html", route: routeFor("VENDOR_CONTACT", { role: "OFFICIAL_ENTRY" }) },
      { id: "CONTACT-SENT", destinationName: "sent.eml", content: "Message-ID: fixture\n", mediaType: "message/rfc822" },
    ],
  });
  const contactOwnerBefore = await readFile(contact.ownerPath);
  const contactSourcesBefore = await Promise.all((await readdir(contact.sourceRoot)).sort().map((name) => readFile(path.join(contact.sourceRoot, name))));
  const contactCapture = await captureEvidence({ root: RUN_ROOT, requestPath: contact.requestRelative });
  const contactCheck = await checkCapture({ root: RUN_ROOT, requestPath: contact.requestRelative });
  check("contact capture and check", contactCheck.artifactCount === 2 && contactCapture.index.artifacts.length === 2, contactCheck);
  check("contact owner byte identity preserved", contactOwnerBefore.equals(await readFile(contact.ownerPath)));
  const contactSourcesAfter = await Promise.all((await readdir(contact.sourceRoot)).sort().map((name) => readFile(path.join(contact.sourceRoot, name))));
  check("contact sources read only", contactSourcesBefore.every((bytes, index) => bytes.equals(contactSourcesAfter[index])));
  check("contact owner fragments are base artifact shape", contactCapture.index.artifacts.every((artifact) =>
    Object.keys(artifact.ownerFragment).sort().join(",") === "bytes,id,mediaType,path,sha256"));

  const benchmark = await createFixture({
    lane: "BENCHMARK_SELLER",
    identity: "REF2-SELLER-EVIDENCE-TEST-01",
    captureId: "BENCHMARK-CAPTURE-01",
    artifacts: [{
      id: "BENCHMARK-CHAT",
      destinationName: "seller-chat.json",
      content: "{\"chat\":true}\n",
      mediaType: "application/json",
      sourceUrl: "https://seller.example/item",
    }],
  });
  const benchmarkOwnerBefore = await readFile(benchmark.ownerPath);
  const benchmarkSourcesBefore = await Promise.all((await readdir(benchmark.sourceRoot)).sort().map((name) => readFile(path.join(benchmark.sourceRoot, name))));
  const benchmarkCapture = await captureEvidence({ root: RUN_ROOT, requestPath: benchmark.requestRelative });
  await checkCapture({ root: RUN_ROOT, requestPath: benchmark.requestRelative });
  const benchmarkFragment = benchmarkCapture.index.artifacts[0].ownerFragment;
  check("benchmark fragment matches owner superset", benchmarkFragment.kind === "SELLER_CHAT_EXPORT" &&
    benchmarkFragment.provenance === "PLATFORM_EXPORT" && benchmarkFragment.capturedAt === "2026-08-04T12:30:00+08:00" &&
    benchmarkFragment.sourceUrl === "https://seller.example/item", benchmarkFragment);
  check("benchmark fragment fields are exactly owner fields",
    Object.keys(benchmarkFragment).sort().join(",") === "bytes,capturedAt,id,kind,mediaType,path,provenance,sha256,sourceUrl",
    benchmarkFragment);
  check("benchmark owner/source byte identity preserved", benchmarkOwnerBefore.equals(await readFile(benchmark.ownerPath)) &&
    (await Promise.all((await readdir(benchmark.sourceRoot)).sort().map((name) => readFile(path.join(benchmark.sourceRoot, name))))).every((bytes, index) => bytes.equals(benchmarkSourcesBefore[index])));

  const lab = await createFixture({
    lane: "LAB_REGISTRY",
    identity: "EVT0-LAB-REGISTRY-TEST-01",
    captureId: "LAB-CAPTURE-01",
  });
  const labOwnerBefore = await readFile(lab.ownerPath);
  const labSourcesBefore = await Promise.all((await readdir(lab.sourceRoot)).sort().map((name) => readFile(path.join(lab.sourceRoot, name))));
  const labCapture = await captureEvidence({ root: RUN_ROOT, requestPath: lab.requestRelative });
  await checkCapture({ root: RUN_ROOT, requestPath: lab.requestRelative });
  check("lab route preserved without owner promotion", labCapture.index.artifacts[0].route.assetId === "DMM-01-MULTIMETER" &&
    labCapture.index.effects.recordStateEffect === "NONE_OWNER_RECORD_UNCHANGED");
  check("lab owner/source byte identity preserved", labOwnerBefore.equals(await readFile(lab.ownerPath)) &&
    (await Promise.all((await readdir(lab.sourceRoot)).sort().map((name) => readFile(path.join(lab.sourceRoot, name))))).every((bytes, index) => bytes.equals(labSourcesBefore[index])));

  const response = await createFixture({
    lane: "VENDOR_RESPONSE",
    identity: "RESPONSE-TEST-01",
    captureId: "RESPONSE-CAPTURE-01",
    artifacts: [
      { id: "RESPONSE-EXPORT", destinationName: "response-export.txt", route: routeFor("VENDOR_RESPONSE", { role: "RESPONSE_EXPORT", referenceIds: [] }) },
      { id: "RESPONSE-TUPLE", destinationName: "identity-tuple.txt", route: routeFor("VENDOR_RESPONSE", { role: "IDENTITY_TUPLE", referenceIds: ["BOARD_MPN", "PCB_REV", "HEAD_MPN", "HEAD_REV", "FW_VERSION"] }) },
      { id: "RESPONSE-ANSWERS", destinationName: "answers.txt", route: routeFor("VENDOR_RESPONSE", { role: "ANSWER", referenceIds: Array.from({ length: 8 }, (_, index) => `M0${index + 1}`) }) },
      { id: "RESPONSE-ATTACHMENTS", destinationName: "attachments.txt", route: routeFor("VENDOR_RESPONSE", { role: "ATTACHMENT", referenceIds: Array.from({ length: 10 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`) }) },
      { id: "RESPONSE-SAMPLES", destinationName: "samples.txt", route: routeFor("VENDOR_RESPONSE", { role: "SAMPLE_OFFER", referenceIds: ["SAMPLE-A", "SAMPLE-B"] }) },
    ],
  });
  const responseOwnerBefore = await readFile(response.ownerPath);
  const responseSourcesBefore = await Promise.all((await readdir(response.sourceRoot)).sort().map((name) => readFile(path.join(response.sourceRoot, name))));
  const responseCapture = await captureEvidence({ root: RUN_ROOT, requestPath: response.requestRelative });
  await checkCapture({ root: RUN_ROOT, requestPath: response.requestRelative });
  check("vendor response route binds tuple/answer/attachment/sample IDs",
    responseCapture.index.artifacts[1].route.referenceIds.length === 5 &&
    responseCapture.index.artifacts[2].route.referenceIds.length === 8 &&
    responseCapture.index.artifacts[3].route.referenceIds.length === 10 &&
    responseCapture.index.artifacts[4].route.referenceIds.length === 2);
  check("vendor response owner/source byte identity preserved", responseOwnerBefore.equals(await readFile(response.ownerPath)) &&
    (await Promise.all((await readdir(response.sourceRoot)).sort().map((name) => readFile(path.join(response.sourceRoot, name))))).every((bytes, index) => bytes.equals(responseSourcesBefore[index])));

  const duplicate = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-DUPLICATE-01",
    captureId: "CONTACT-DUPLICATE-CAPTURE",
    artifacts: [
      { id: "DUP-A", destinationName: "same.txt" },
      { id: "DUP-B", destinationName: "SAME.TXT" },
    ],
  });
  await expectReject("case-insensitive destination collision rejected",
    () => captureEvidence({ root: RUN_ROOT, requestPath: duplicate.requestRelative }), /duplicate destination name/i);

  const duplicateId = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-DUPLICATE-ID-01",
    captureId: "CONTACT-DUPLICATE-ID-CAPTURE",
    artifacts: [
      { id: "DUPLICATE", destinationName: "one.txt" },
      { id: "duplicate", destinationName: "two.txt" },
    ],
  });
  await expectReject("case-insensitive artifact ID collision rejected",
    () => captureEvidence({ root: RUN_ROOT, requestPath: duplicateId.requestRelative }), /schema failure|duplicate artifact id/i);

  const existing = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-EXISTING-01",
    captureId: "CONTACT-EXISTING-CAPTURE",
  });
  await writeFile(path.join(existing.rawAbsolute, "contact-existing-capture-a.txt"), "preexisting\n", "utf8");
  await expectReject("existing destination is never overwritten",
    () => captureEvidence({ root: RUN_ROOT, requestPath: existing.requestRelative }), /destination already exists/i);
  check("preexisting destination bytes retained", (await readFile(path.join(existing.rawAbsolute, "contact-existing-capture-a.txt"), "utf8")) === "preexisting\n");

  const existingCase = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-EXISTING-CASE-01",
    captureId: "CONTACT-EXISTING-CASE-CAPTURE",
  });
  await writeFile(path.join(existingCase.rawAbsolute, "CONTACT-EXISTING-CASE-CAPTURE-A.TXT"), "preexisting-case\n", "utf8");
  await expectReject("existing case-folded destination is never overwritten",
    () => captureEvidence({ root: RUN_ROOT, requestPath: existingCase.requestRelative }), /destination already exists/i);

  const badRoute = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-BAD-ROUTE-01",
    captureId: "CONTACT-BAD-ROUTE-CAPTURE",
    requestMutator(request) {
      request.artifacts[0].route = routeFor("BENCHMARK_SELLER");
    },
  });
  await expectReject("lane and route mismatch rejected",
    () => captureEvidence({ root: RUN_ROOT, requestPath: badRoute.requestRelative }), /schema failure|route kind/i);

  const badTimestamp = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-BAD-TIME-01",
    captureId: "CONTACT-BAD-TIME-CAPTURE",
    requestMutator(request) { request.artifacts[0].capturedAt = "2026-08-04"; },
  });
  await expectReject("timezone-qualified timestamp required",
    () => captureEvidence({ root: RUN_ROOT, requestPath: badTimestamp.requestRelative }), /schema failure|capturedAt must be/i);

  const badUrl = await createFixture({
    lane: "BENCHMARK_SELLER",
    identity: "REF2-SELLER-EVIDENCE-BAD-URL",
    captureId: "BENCHMARK-BAD-URL-CAPTURE",
    requestMutator(request) { request.artifacts[0].sourceUrl = "file:///private/path"; },
  });
  await expectReject("non-HTTP source URL rejected",
    () => captureEvidence({ root: RUN_ROOT, requestPath: badUrl.requestRelative }), /schema failure|sourceUrl must be/i);

  const badLab = await createFixture({
    lane: "LAB_REGISTRY",
    identity: "EVT0-LAB-REGISTRY-BAD-ASSET",
    captureId: "LAB-BAD-ASSET-CAPTURE",
    requestMutator(request) { request.artifacts[0].route.assetId = "DMM-01-UNKNOWN"; },
  });
  await expectReject("lab route must name an existing owner asset",
    () => captureEvidence({ root: RUN_ROOT, requestPath: badLab.requestRelative }), /asset .* missing or duplicated/i);

  const badResponse = await createFixture({
    lane: "VENDOR_RESPONSE",
    identity: "RESPONSE-BAD-REF-01",
    captureId: "RESPONSE-BAD-REF-CAPTURE",
    requestMutator(request) { request.artifacts[0].route.referenceIds = ["A01"]; },
  });
  await expectReject("vendor response role and reference ID must agree",
    () => captureEvidence({ root: RUN_ROOT, requestPath: badResponse.requestRelative }), /outside ANSWER/i);

  const badRouteExtra = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-BAD-ROUTE-EXTRA-01",
    captureId: "CONTACT-BAD-ROUTE-EXTRA-CAPTURE",
    requestMutator(request) { request.artifacts[0].route.extra = true; },
  });
  await expectReject("route metadata is closed by schema",
    () => captureEvidence({ root: RUN_ROOT, requestPath: badRouteExtra.requestRelative }), /schema failure/i);

  const identityMismatch = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-IDENTITY-MISMATCH",
    captureId: "CONTACT-IDENTITY-CAPTURE",
    ownerMutator(owner) { owner.receiptId = "OTHER-IDENTITY"; },
  });
  await expectReject("owner identity must equal workspace identity",
    () => preflightWorkspace({ root: RUN_ROOT, laneId: "VENDOR_CONTACT", workspaceRoot: identityMismatch.workspaceRoot }), /does not match workspace/i);

  const misplaced = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-MISPLACED-01",
    captureId: "CONTACT-MISPLACED-CAPTURE",
  });
  const wrongRequest = `${misplaced.workspaceRoot}/capture-request.WRONG-NAME.json`;
  await writeFile(path.join(RUN_ROOT, ...wrongRequest.split("/")), await readFile(misplaced.requestPath));
  await expectReject("request filename is bound to capture ID",
    () => captureEvidence({ root: RUN_ROOT, requestPath: wrongRequest }), /must be stored at/i);

  const absoluteSource = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-ABSOLUTE-SOURCE-01",
    captureId: "CONTACT-ABSOLUTE-SOURCE-CAPTURE",
    requestMutator(request) { request.artifacts[0].sourcePath = path.join(RUN_ROOT, "outside.txt"); },
  });
  await expectReject("absolute source path is rejected",
    () => captureEvidence({ root: RUN_ROOT, requestPath: absoluteSource.requestRelative }), /schema failure|relative|absolute|sourcePath/i);

  const unnormalizedSource = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-UNNORMALIZED-SOURCE-01",
    captureId: "CONTACT-UNNORMALIZED-SOURCE-CAPTURE",
    requestMutator(request) { request.artifacts[0].sourcePath = "incoming/./CONTACT-UNNORMALIZED-SOURCE-CAPTURE/source-0.txt"; },
  });
  await expectReject("source path normalization is enforced",
    () => captureEvidence({ root: RUN_ROOT, requestPath: unnormalizedSource.requestRelative }), /not normalized|empty or dot/i);

  const escapingSource = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-ESCAPING-SOURCE-01",
    captureId: "CONTACT-ESCAPING-SOURCE-CAPTURE",
    requestMutator(request) { request.artifacts[0].sourcePath = "../../../../../../outside.txt"; },
  });
  await expectReject("source path repository escape is rejected",
    () => captureEvidence({ root: RUN_ROOT, requestPath: escapingSource.requestRelative }), /escapes the repository/i);

  await expectReject("workspace parent path is rejected",
    () => preflightWorkspace({ root: RUN_ROOT, laneId: "VENDOR_CONTACT", workspaceRoot: "build/vendor-contact-receipts/../escape" }), /parent segment|normalized/i);

  const rollback = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-ROLLBACK-01",
    captureId: "CONTACT-ROLLBACK-CAPTURE",
    artifacts: [
      { id: "ROLLBACK-A", destinationName: "rollback-a.txt" },
      { id: "ROLLBACK-B", destinationName: "rollback-b.txt" },
    ],
  });
  await expectReject("failure after first promotion triggers rollback",
    () => captureEvidence({
      root: RUN_ROOT,
      requestPath: rollback.requestRelative,
      testHooks: {
        afterPromote({ promoted }) {
          if (promoted.length === 1) throw new Error("INJECTED_AFTER_FIRST_PROMOTE");
        },
      },
    }), /INJECTED_AFTER_FIRST_PROMOTE/);
  check("rollback removes only newly promoted destinations",
    !(await fileExists(path.join(rollback.rawAbsolute, "rollback-a.txt"))) &&
    !(await fileExists(path.join(rollback.rawAbsolute, "rollback-b.txt"))));
  check("rollback removes staging directory and withholds index",
    !(await fileExists(path.join(rollback.workspaceAbsolute, `capture-index.${rollback.request.captureId}.json`))) &&
    !(await fileExists(path.join(rollback.workspaceAbsolute, `.capture-stage.${rollback.request.captureId}.${process.pid}`))));

  const ownerRace = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-OWNER-RACE-01",
    captureId: "CONTACT-OWNER-RACE-CAPTURE",
  });
  await expectReject("owner mutation during capture is detected",
    () => captureEvidence({
      root: RUN_ROOT,
      requestPath: ownerRace.requestRelative,
      testHooks: {
        afterStage: async () => writeFile(ownerRace.ownerPath, "{\"changed\":true}\n", "utf8"),
      },
    }), /owner record changed during capture/i);
  check("owner-race destination rolled back", !(await fileExists(path.join(ownerRace.rawAbsolute, "contact-owner-race-capture-a.txt"))));

  const requestRace = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-REQUEST-RACE-01",
    captureId: "CONTACT-REQUEST-RACE-CAPTURE",
  });
  const requestRaceBytes = await readFile(requestRace.requestPath);
  await expectReject("request mutation during index commit is detected",
    () => captureEvidence({
      root: RUN_ROOT,
      requestPath: requestRace.requestRelative,
      testHooks: {
        beforeIndex: async () => writeFile(requestRace.requestPath, Buffer.concat([requestRaceBytes, Buffer.from(" ")])),
      },
    }), /capture request changed during capture/i);
  check("request-race destination rolled back", !(await fileExists(path.join(requestRace.rawAbsolute, "contact-request-race-capture-a.txt"))));

  const sameIndexRace = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-INDEX-RACE-01",
    captureId: "CONTACT-INDEX-RACE-CAPTURE",
  });
  const sameIndexRacePath = path.join(sameIndexRace.workspaceAbsolute, `capture-index.${sameIndexRace.request.captureId}.json`);
  let sameIndexRaceBytes = null;
  await expectReject("canonical index created before commit is rejected",
    () => captureEvidence({
      root: RUN_ROOT,
      requestPath: sameIndexRace.requestRelative,
      testHooks: {
        beforeIndex: async ({ index }) => {
          sameIndexRaceBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, "utf8");
          await writeFile(sameIndexRacePath, sameIndexRaceBytes);
        },
      },
    }), /EEXIST|already exists|file already exists/i);
  check("canonical external index bytes are retained", sameIndexRaceBytes?.equals(await readFile(sameIndexRacePath)), {
    indexPath: sameIndexRacePath,
    bytes: sameIndexRaceBytes?.length,
  });
  check("index-race destinations roll back", !(await fileExists(path.join(sameIndexRace.rawAbsolute, "contact-index-race-capture-a.txt"))));
  check("index-race staging is removed", !(await fileExists(path.join(sameIndexRace.workspaceAbsolute, `.capture-stage.${sameIndexRace.request.captureId}.${process.pid}`))));

  const afterIndexRace = await createFixture({
    lane: "VENDOR_CONTACT",
    identity: "CONTACT-AFTER-INDEX-RACE-01",
    captureId: "CONTACT-AFTER-INDEX-RACE-CAPTURE",
  });
  await expectReject("post-index request mutation is rolled back",
    () => captureEvidence({
      root: RUN_ROOT,
      requestPath: afterIndexRace.requestRelative,
      testHooks: {
        afterIndex: async () => writeFile(afterIndexRace.requestPath, Buffer.concat([await readFile(afterIndexRace.requestPath), Buffer.from(" ")])),
      },
    }), /capture request changed during capture/i);
  check("post-index race removes owned index and destination",
    !(await fileExists(path.join(afterIndexRace.workspaceAbsolute, `capture-index.${afterIndexRace.request.captureId}.json`))) &&
    !(await fileExists(path.join(afterIndexRace.rawAbsolute, "contact-after-index-race-capture-a.txt"))));

  await expectReject("capture ID is immutable and single-use",
    () => captureEvidence({ root: RUN_ROOT, requestPath: contact.requestRelative }), /capture index already exists/i);

  const contactIndexPath = path.join(contact.workspaceAbsolute, `capture-index.${contact.request.captureId}.json`);
  const originalIndex = await readFile(contactIndexPath);
  await writeFile(contactIndexPath, Buffer.concat([originalIndex.subarray(0, -1), Buffer.from(" \n")]));
  await expectReject("capture index byte tamper rejected",
    () => checkCapture({ root: RUN_ROOT, requestPath: contact.requestRelative }), /does not match|canonical pretty-JSON/i);
  await writeFile(contactIndexPath, originalIndex);
  const originalDestination = await readFile(path.join(contact.rawAbsolute, "sent.eml"));
  await writeFile(path.join(contact.rawAbsolute, "sent.eml"), "tampered\n", "utf8");
  await expectReject("captured destination byte tamper rejected",
    () => checkCapture({ root: RUN_ROOT, requestPath: contact.requestRelative }), /does not match/i);
  await writeFile(path.join(contact.rawAbsolute, "sent.eml"), originalDestination);

  const originalRequest = await readFile(contact.requestPath);
  const tamperedRequest = JSON.parse(originalRequest.toString("utf8"));
  tamperedRequest.artifacts[0].mediaType = "application/x-tampered";
  await writeFile(contact.requestPath, `${JSON.stringify(tamperedRequest, null, 2)}\n`, "utf8");
  await expectReject("capture request byte tamper rejected",
    () => checkCapture({ root: RUN_ROOT, requestPath: contact.requestRelative }), /does not match/i);
  await writeFile(contact.requestPath, originalRequest);
  await checkCapture({ root: RUN_ROOT, requestPath: contact.requestRelative });

  await expectReject("capture index remains immutable and single-use after check",
    () => captureEvidence({ root: RUN_ROOT, requestPath: contact.requestRelative }), /capture index already exists/i);

  const report = {
    schemaVersion: 1,
    reportKind: "hardware-evidence-capture-selftest-v1",
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
    },
    passed: checks.every((item) => item.passed),
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Hardware evidence capture selftest: ${report.passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total})\n`);
  process.stdout.write(`Report: ${path.relative(ROOT, REPORT_PATH)}\n`);
}

try {
  await run();
} finally {
  await rm(RUN_ROOT, { recursive: true, force: true });
}
