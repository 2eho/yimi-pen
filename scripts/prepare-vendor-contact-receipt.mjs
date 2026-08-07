import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const messageId = option("--message-id");
const receiptId = option("--receipt-id");
if (!messageId || !receiptId) {
  fail("Usage: node scripts/prepare-vendor-contact-receipt.mjs --message-id <MB1 message ID> --receipt-id <unique receipt ID>");
} else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(receiptId)) {
  fail("--receipt-id must use 3-81 ASCII letters, digits, dot, underscore or hyphen");
} else {
  const outboundRoot = path.join(root, "build", "vendor-outbound-v1");
  const manifestSource = path.join(outboundRoot, "bundle-manifest.json");
  const manifestBytes = await readFile(manifestSource);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const message = manifest.messages.find((entry) => entry.messageId === messageId);
  if (!message) {
    fail(`Unknown --message-id ${messageId}; available: ${manifest.messages.map((entry) => entry.messageId).join(", ")}`);
  } else {
    const emailArtifact = message.artifacts.find((artifact) => artifact.path.endsWith(".email.txt"));
    const recipientArtifact = message.artifacts.find((artifact) => artifact.path.endsWith(".recipient-entry.json"));
    if (!emailArtifact || !recipientArtifact) {
      fail(`Outbound manifest message ${messageId} lacks email or recipient-entry artifact`);
    } else {
      const receiptRoot = path.join(root, "build", "vendor-contact-receipts", receiptId);
      try {
        await stat(receiptRoot);
        fail(`Receipt workspace already exists: ${receiptRoot}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (!process.exitCode) {
        const receiptParent = path.dirname(receiptRoot);
        const stagingRoot = path.join(receiptParent, `.${receiptId}.staging-${process.pid}`);
        const archiveRoot = path.join(stagingRoot, "outbound");
        await mkdir(receiptParent, { recursive: true });
        await mkdir(stagingRoot);
        await cp(outboundRoot, archiveRoot, { recursive: true, errorOnExist: true, force: false });
        await mkdir(path.join(stagingRoot, "raw"), { recursive: true });

        const recipientDocument = JSON.parse(await readFile(path.join(outboundRoot, recipientArtifact.path), "utf8"));
        const template = JSON.parse(await readFile(path.join(root, "hardware", "evt0", "vendor-contact-receipts-v1", "receipt.template.json"), "utf8"));
        const draft = structuredClone(template);
        draft.receiptId = receiptId;
        draft.messageId = message.messageId;
        draft.candidateId = message.candidateId;
        draft.sourceRefs = message.sourceRefs;
        draft.outboundBundle = {
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
        draft.contactEndpoint.officialEntryUrl = recipientDocument.recipientEntry.officialEntryUrl;
        draft.decision.reason = "Prepared immutable outbound archive; official endpoint verification and manual submission remain pending.";

        await writeFile(path.join(stagingRoot, "receipt.draft.json"), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
        const checklist = [
          `供应商发送回执工作区：${receiptId}`,
          `消息：${message.messageId}`,
          `候选：${message.candidateId}`,
          `外发包：${manifest.reproducibleId}`,
          `发送当日需重新核验的官方入口：${recipientDocument.recipientEntry.officialEntryUrl}`,
          "",
          "1. 把当前官方联系页或表单原件保存到 raw/。",
          "2. 通过刚核验的官方渠道发送 outbound/messages/*.email.txt 中对应文本。",
          "3. 把已发送邮件导出件或网页确认页原件保存到 raw/。",
          "4. 将 receipt.draft.json 复制到 hardware/evt0/vendor-contact-receipts-v1/records/<receipt-id>.json。",
          "5. 填写 verifiedAt、sentAt/channel、原件 bytes/SHA-256 和引用；邮件 recipientValue 必须取归档 recipient-entry 的列出地址，表单/FAE 则填精确官方入口 URL。",
          "6. transportReference 填实际 Message-ID、网页确认号或 FAE 工单号；仅有本地截图且没有传输引用时保持 PENDING_SEND。",
          "7. 将 decision 设为 AWAITING_RESPONSE，并保留 SUPPLIER_RESPONSE_PENDING；随后运行 npm run validate:vendor-contact-receipts。",
          "8. 任一发送证据尚未取得时保持 PENDING_SEND；回执不证明供应商已阅读或回复。",
          "",
        ].join("\n");
        await writeFile(path.join(stagingRoot, "SEND-CHECKLIST.txt"), checklist, "utf8");
        await rename(stagingRoot, receiptRoot);

        console.log(`Prepared vendor contact receipt workspace: ${receiptRoot}`);
        console.log(`Message: ${message.messageId}; candidate: ${message.candidateId}`);
        console.log(`Bundle: ${manifest.reproducibleId}`);
        console.log("State: PENDING_SEND; no submission, response, payment or BOARD_TARGET fact created");
      }
    }
  }
}
