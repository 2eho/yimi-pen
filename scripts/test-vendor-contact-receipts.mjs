import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const receiptId = `SELFTEST-${process.pid}-${randomUUID().slice(0, 8)}`;
const testRoot = path.join(root, "build", "vendor-contact-receipts", receiptId);
const isolatedRoot = path.join(root, "build", `vendor-contact-receipts-selftest-${process.pid}-${randomUUID().slice(0, 8)}`);
const recordsRoot = path.join(isolatedRoot, "records");
const reportPath = path.join(isolatedRoot, "validation.json");
const recordPath = path.join(recordsRoot, `${receiptId}.json`);
const outboundSource = path.join(root, "build", "vendor-outbound-v1");
const templatePath = path.join(root, "hardware", "evt0", "vendor-contact-receipts-v1", "receipt.template.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runValidator() {
  return spawnSync(process.execPath, [path.join(root, "scripts", "validate-vendor-contact-receipts.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      VENDOR_CONTACT_RECEIPT_RECORDS_DIR: path.relative(root, recordsRoot),
      VENDOR_CONTACT_RECEIPT_REPORT_PATH: path.relative(root, reportPath),
    },
  });
}

try {
  await mkdir(path.join(testRoot, "raw"), { recursive: true });
  await mkdir(recordsRoot, { recursive: true });
  await cp(outboundSource, path.join(testRoot, "outbound"), { recursive: true, force: false, errorOnExist: true });

  const manifestBytes = await readFile(path.join(testRoot, "outbound", "bundle-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const message = manifest.messages.find((item) => item.messageId === "MB1-OUT-ZTRON-LOCAL");
  const emailArtifact = message.artifacts.find((artifact) => artifact.path.endsWith(".email.txt"));
  const recipientArtifact = message.artifacts.find((artifact) => artifact.path.endsWith(".recipient-entry.json"));
  const recipientDocument = JSON.parse(await readFile(path.join(testRoot, "outbound", recipientArtifact.path), "utf8"));
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  const syntheticSentAt = new Date(Date.now() - 60 * 1000);
  const syntheticVerifiedAt = new Date(syntheticSentAt.getTime() - 60 * 1000);
  const contactBytes = Buffer.from("<html><body>synthetic official-contact fixture</body></html>\n", "utf8");
  const submissionBytes = Buffer.from("Synthetic submission fixture; validator self-test only.\n", "utf8");
  await writeFile(path.join(testRoot, "raw", "contact.html"), contactBytes);
  await writeFile(path.join(testRoot, "raw", "sent.eml"), submissionBytes);

  template.receiptId = receiptId;
  template.messageId = message.messageId;
  template.candidateId = message.candidateId;
  template.sourceRefs = message.sourceRefs;
  template.outboundBundle = {
    bundleId: manifest.bundleId,
    reproducibleId: manifest.reproducibleId,
    manifestPath: `build/vendor-contact-receipts/${receiptId}/outbound/bundle-manifest.json`,
    manifestBytes: manifestBytes.length,
    manifestSha256: sha256(manifestBytes),
    messageArtifactPath: `build/vendor-contact-receipts/${receiptId}/outbound/${emailArtifact.path}`,
    messageArtifactBytes: emailArtifact.bytes,
    messageArtifactSha256: emailArtifact.sha256,
    recipientArtifactPath: `build/vendor-contact-receipts/${receiptId}/outbound/${recipientArtifact.path}`,
    recipientArtifactBytes: recipientArtifact.bytes,
    recipientArtifactSha256: recipientArtifact.sha256,
  };
  template.contactEndpoint = {
    officialEntryUrl: recipientDocument.recipientEntry.officialEntryUrl,
    verifiedAt: syntheticVerifiedAt.toISOString(),
    recipientKind: "EMAIL",
    recipientValue: recipientDocument.recipientEntry.listedAddresses[0],
    verificationArtifactRefs: ["CONTACT-PAGE"],
  };
  template.submission = {
    state: "SUBMITTED",
    sentAt: syntheticSentAt.toISOString(),
    channel: "EMAIL",
    transportReference: "SYNTHETIC-FIXTURE",
    submissionArtifactRefs: ["SEND-RECEIPT"],
  };
  template.rawArtifacts = [
    {
      id: "CONTACT-PAGE",
      path: `build/vendor-contact-receipts/${receiptId}/raw/contact.html`,
      bytes: contactBytes.length,
      sha256: sha256(contactBytes),
      mediaType: "text/html",
    },
    {
      id: "SEND-RECEIPT",
      path: `build/vendor-contact-receipts/${receiptId}/raw/sent.eml`,
      bytes: submissionBytes.length,
      sha256: sha256(submissionBytes),
      mediaType: "message/rfc822",
    },
  ];
  template.decision = {
    status: "AWAITING_RESPONSE",
    reason: "Synthetic validator fixture only.",
    blockers: ["SUPPLIER_RESPONSE_PENDING"],
  };
  await writeFile(recordPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");

  const positive = runValidator();
  if (positive.status !== 0 || !positive.stdout.includes("submitted: 1")) {
    throw new Error(`positive record closure failed\n${positive.stdout}\n${positive.stderr}`);
  }

  const duplicatePath = path.join(recordsRoot, `DUPLICATE-${receiptId}.json`);
  await cp(recordPath, duplicatePath);
  const duplicate = runValidator();
  if (duplicate.status === 0 || !duplicate.stderr.includes("receiptId")) {
    throw new Error(`duplicate receipt rejection failed\n${duplicate.stdout}\n${duplicate.stderr}`);
  }
  await rm(duplicatePath, { force: true });

  await writeFile(path.join(testRoot, "raw", "sent.eml"), Buffer.concat([submissionBytes, Buffer.from("tamper\n")])) ;
  const tampered = runValidator();
  if (tampered.status === 0 || !tampered.stderr.includes("sha256")) {
    throw new Error(`tamper rejection failed\n${tampered.stdout}\n${tampered.stderr}`);
  }

  console.log("Vendor Contact Receipt self-test: 3/3 passed (complete file closure; duplicate-ID rejection; tamper rejection)");
} finally {
  await rm(testRoot, { recursive: true, force: true });
  await rm(isolatedRoot, { recursive: true, force: true });
}
