export class CaptureSourceUseCaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CaptureSourceUseCaseError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new CaptureSourceUseCaseError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function errorCode(error) {
  return error?.code ?? error?.name ?? "UNKNOWN";
}

function assertCapturePort(capturePort) {
  assert(
    capturePort
      && typeof capturePort.capture === "function"
      && typeof capturePort.discard === "function",
    "CAPTURE_PORT_INVALID",
    "capture source use-case requires capture and discard ports",
  );
}

function assertCaptureReceipt(receipt) {
  assert(
    receipt
      && typeof receipt.captureId === "string"
      && receipt.captureId.length > 0
      && typeof receipt.sourceClass === "string"
      && receipt.sourceClass.length > 0
      && typeof receipt.sourcePath === "string"
      && receipt.sourcePath.length > 0
      && receipt.codecProfile === "WAV_PCM16_16K_MONO"
      && Number.isInteger(receipt.durationMs)
      && receipt.durationMs > 0,
    "CAPTURE_RECEIPT_INVALID",
    "capture port returned a malformed canonical audio receipt",
  );
}

function assertImportedAsset(importedAsset) {
  assert(
    importedAsset
      && typeof importedAsset.assetId === "string"
      && importedAsset.assetId.length > 0
      && typeof importedAsset.absolutePath === "string"
      && importedAsset.absolutePath.length > 0
      && typeof importedAsset.contentPath === "string"
      && importedAsset.contentPath.length > 0
      && typeof importedAsset.sha256 === "string"
      && /^[a-f0-9]{64}$/u.test(importedAsset.sha256)
      && Number.isSafeInteger(importedAsset.bytes)
      && importedAsset.bytes > 0
      && importedAsset.codec === "WAV_PCM16_16K_MONO"
      && Number.isInteger(importedAsset.durationMs)
      && importedAsset.durationMs > 0,
    "CAPTURE_IMPORT_RECEIPT_INVALID",
    "canonical audio import port returned a malformed asset receipt",
  );
}

function abortedError(stage, importedAssetPublished = false) {
  return new CaptureSourceUseCaseError(
    "CAPTURE_REQUEST_ABORTED",
    "capture source request was cancelled",
    { stage, importedAssetPublished, cleanupComplete: true },
  );
}

function normalizeCapturePortError(error) {
  const adapterCode = errorCode(error);
  const cleanupComplete = error?.details?.cleanupComplete !== false;
  if (adapterCode === "HOST_AUDIO_PROCESS_ABORTED" || adapterCode === "CAPTURE_REQUEST_ABORTED") {
    return new CaptureSourceUseCaseError("CAPTURE_REQUEST_ABORTED", "capture source request was cancelled", {
      stage: "capture",
      adapterCode,
      cleanupComplete,
    });
  }
  if (adapterCode === "HOST_AUDIO_PROCESS_TIMEOUT" || adapterCode === "CAPTURE_REQUEST_TIMEOUT") {
    return new CaptureSourceUseCaseError("CAPTURE_REQUEST_TIMEOUT", "capture source request timed out", {
      stage: "capture",
      adapterCode,
      cleanupComplete,
    });
  }
  if (adapterCode === "CAPTURE_SOURCE_CLEANUP_FAILED" || cleanupComplete === false) {
    return new CaptureSourceUseCaseError("CAPTURE_SOURCE_CLEANUP_FAILED", "capture adapter cleanup failed", {
      stage: "capture",
      adapterCode,
      cleanupComplete: false,
    });
  }
  return new CaptureSourceUseCaseError("CAPTURE_REQUEST_FAILED", "capture source adapter rejected the request", {
    stage: "capture",
    adapterCode,
    cleanupComplete: true,
  });
}

/**
 * Application-level capture seam.
 *
 * The capture adapter owns its temporary source, while the import adapter owns
 * the immutable content-addressed asset. The temporary source is discarded on
 * every post-capture path before an imported asset can reach Family authoring.
 */
export async function captureCanonicalAudioAsset({
  capturePort,
  importPort,
  captureRequest,
  signal,
}) {
  assertCapturePort(capturePort);
  assert(typeof importPort === "function", "CAPTURE_IMPORT_PORT_INVALID", "canonical audio import port is required");
  assert(captureRequest && typeof captureRequest === "object",
    "CAPTURE_REQUEST_INVALID", "capture request is required");
  if (signal?.aborted) throw abortedError("before-capture");

  let captured;
  try {
    captured = await capturePort.capture({ ...captureRequest, signal });
  } catch (error) {
    throw normalizeCapturePortError(error);
  }
  let importedAsset = null;
  let primaryError = null;
  try {
    assertCaptureReceipt(captured);
    if (signal?.aborted) throw abortedError("after-capture");
    importedAsset = await importPort({ sourcePath: captured.sourcePath, capture: captured });
    assertImportedAsset(importedAsset);
    if (signal?.aborted) throw abortedError("after-import", true);
  } catch (error) {
    primaryError = error;
  }

  try {
    const cleanup = await capturePort.discard(captured);
    assert(cleanup?.cleanupComplete === true,
      "CAPTURE_SOURCE_CLEANUP_INCOMPLETE", "capture port did not prove temporary source cleanup");
  } catch (cleanupError) {
    throw new CaptureSourceUseCaseError(
      "CAPTURE_SOURCE_CLEANUP_FAILED",
      "temporary capture source cleanup failed",
      {
        captureId: captured?.captureId ?? null,
        originalCode: primaryError ? errorCode(primaryError) : null,
        cleanupCode: errorCode(cleanupError),
        importedAssetPublished: importedAsset !== null,
        cleanupComplete: false,
      },
    );
  }

  if (primaryError) throw primaryError;
  return Object.freeze({
    importedAsset,
    captureReceipt: Object.freeze({
      captureId: captured.captureId,
      sourceClass: captured.sourceClass,
      adapter: captured.adapter,
      durationMs: captured.durationMs,
      codecProfile: captured.codecProfile,
      executableSha256: captured.executableSha256 ?? null,
      temporarySourceDiscarded: true,
    }),
  });
}
