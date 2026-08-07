import { createFamilyWorkspaceLifecycleFilesystemAdapter } from "./family-workspace-lifecycle-filesystem-adapter.mjs";
import { createFamilyWorkspaceLifecycle } from "./family-workspace-lifecycle-service.mjs";

const [allowedRoot, workspaceDirectoryName] = process.argv.slice(2);
if (!allowedRoot || !workspaceDirectoryName) throw new Error("allowedRoot and workspaceDirectoryName are required");
const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
const records = await adapter.list({ allowedRoot });
const lifecycle = createFamilyWorkspaceLifecycle({
  allowedRoot,
  workspaceOptions: {
    probeCanonicalWav: async () => ({
      codecProfile: "WAV_PCM16_16K_MONO",
      durationMs: 1,
    }),
    maxImportBytes: 1024 * 1024,
    maintenanceLimits: {
      maxBackupBytes: 4 * 1024 * 1024,
      maxEntries: 128,
      maxAssetBytes: 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    },
    capturePortFactory: null,
  },
  clock: () => "2026-08-05T12:00:00.000Z",
});
const opened = await lifecycle.open({
  workspaceDirectoryName,
  operationId: "OP-LIFECYCLE-CHILD-OPEN",
});
const beforeHead = await opened.workspace.read.open();
const listed = await lifecycle.list();
const descriptor = listed.find((item) => item.workspaceDirectoryName === workspaceDirectoryName);
await lifecycle.close({
  workspaceDirectoryName,
  operationId: "OP-LIFECYCLE-CHILD-CLOSE",
});
const reopened = await lifecycle.reopen({
  workspaceDirectoryName,
  operationId: "OP-LIFECYCLE-CHILD-REOPEN",
});
const afterHead = await reopened.workspace.read.open();
await lifecycle.close({
  workspaceDirectoryName,
  operationId: "OP-LIFECYCLE-CHILD-CLOSE-REOPENED",
});
process.stdout.write(`${JSON.stringify({
  listCount: records.length,
  workspaceId: descriptor?.workspaceId ?? null,
  state: descriptor?.state ?? null,
  headRevisionId: afterHead.headRevisionId,
  distinctCapability: opened.workspace !== reopened.workspace,
  sameHead: JSON.stringify(beforeHead) === JSON.stringify(afterHead),
})}\n`);
