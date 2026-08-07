import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const token = `SELFTEST-${process.pid}-${randomUUID().slice(0, 8)}`;
const isolatedRoot = path.join(root, "build", `vendor-contact-send-readiness-selftest-${token}`);
const workspacesRoot = path.join(isolatedRoot, "workspaces");
const recordsRoot = path.join(isolatedRoot, "records");
const reportPath = path.join(isolatedRoot, "report.json");
const workspace = path.join(workspacesRoot, token);
const checker = path.join(root, "scripts", "check-vendor-contact-send-readiness.mjs");
const currentOutbound = path.join(root, "build", "vendor-outbound-v1");
const templatePath = path.join(root, "hardware", "evt0", "vendor-contact-receipts-v1", "receipt.template.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run() {
  return spawnSync(process.execPath, [checker, "--all"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      VENDOR_CONTACT_WORKSPACES_DIR: path.relative(root, workspacesRoot),
      VENDOR_CONTACT_RECEIPT_RECORDS_DIR: path.relative(root, recordsRoot),
      VENDOR_CONTACT_SEND_READINESS_REPORT_PATH: path.relative(root, reportPath),
    },
  });
}

function requireResult(name, result, expectedSuccess, detail) {
  const success = result.status === 0;
  if (success !== expectedSuccess || (detail && !`${result.stdout}\n${result.stderr}`.includes(detail))) {
    throw new Error(`${name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  console.log(`Vendor contact send readiness self-test: ${name} PASS`);
}

try {
  await mkdir(workspacesRoot, { recursive: true });
  await mkdir(recordsRoot, { recursive: true });
  await mkdir(path.join(workspace, "raw"), { recursive: true });
  await cp(currentOutbound, path.join(workspace, "outbound"), { recursive: true, errorOnExist: true, force: false });

  const manifestBytes = await readFile(path.join(workspace, "outbound", "bundle-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const message = manifest.messages.find((entry) => entry.messageId === "MB1-OUT-ZTRON-LOCAL");
  const messageArtifact = message.artifacts.find((artifact) => artifact.path.endsWith(".email.txt"));
  const recipientArtifact = message.artifacts.find((artifact) => artifact.path.endsWith(".recipient-entry.json"));
  const recipient = JSON.parse(await readFile(path.join(workspace, "outbound", recipientArtifact.path), "utf8"));
  const draftPath = path.join(workspace, "receipt.draft.json");
  const draft = JSON.parse(await readFile(templatePath, "utf8"));
  draft.receiptId = token;
  draft.messageId = message.messageId;
  draft.candidateId = message.candidateId;
  draft.sourceRefs = message.sourceRefs;
  const isolatedWorkspacePath = path.relative(root, workspace).replaceAll("\\", "/");
  draft.outboundBundle = {
    bundleId: manifest.bundleId,
    reproducibleId: manifest.reproducibleId,
    manifestPath: `${isolatedWorkspacePath}/outbound/bundle-manifest.json`,
    manifestBytes: manifestBytes.length,
    manifestSha256: sha256(manifestBytes),
    messageArtifactPath: `${isolatedWorkspacePath}/outbound/${messageArtifact.path}`,
    messageArtifactBytes: messageArtifact.bytes,
    messageArtifactSha256: messageArtifact.sha256,
    recipientArtifactPath: `${isolatedWorkspacePath}/outbound/${recipientArtifact.path}`,
    recipientArtifactBytes: recipientArtifact.bytes,
    recipientArtifactSha256: recipientArtifact.sha256,
  };
  draft.contactEndpoint.officialEntryUrl = recipient.recipientEntry.officialEntryUrl;
  draft.decision.reason = "Isolated preflight self-test fixture.";
  await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await writeFile(path.join(workspace, "SEND-CHECKLIST.txt"), "Synthetic preflight checklist fixture.\n", "utf8");

  requireResult("positive isolated workspace", run(), true, "PASS (1/1 ready)");

  const messagePath = path.resolve(root, draft.outboundBundle.messageArtifactPath);
  const originalMessage = await readFile(messagePath);
  await writeFile(messagePath, Buffer.concat([originalMessage, Buffer.from("tamper\n")]));
  requireResult("message tamper rejection", run(), false, "message artifact identity");
  await writeFile(messagePath, originalMessage);

  await writeFile(path.join(workspace, "raw", "contact.html"), "fixture\n", "utf8");
  requireResult("non-empty raw rejection", run(), false, "raw directory empty");
  await rm(path.join(workspace, "raw", "contact.html"), { force: true });

  await writeFile(path.join(recordsRoot, `${token}.json`), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  requireResult("formal record collision rejection", run(), false, "formal record absent");

  console.log("Vendor contact send readiness self-test: 4/4 passed");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
