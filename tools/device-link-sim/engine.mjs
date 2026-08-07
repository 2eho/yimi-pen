import { createHash } from "node:crypto";

const RESPONSE_BASE = Object.freeze({ schemaVersion: 1, profile: "loopback-json-v1", kind: "response" });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function equal(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export class DeviceLinkReferenceHandler {
  constructor(fixture) {
    this.state = {
      activeSnapshotId: fixture.activeSnapshotId,
      lastGoodSnapshotId: fixture.lastGoodSnapshotId,
      generation: fixture.generation,
      transactions: {},
    };
    this.requestLedger = new Map();
  }

  semanticState() {
    const transactions = Object.fromEntries(
      Object.entries(this.state.transactions).sort(([a], [b]) => a.localeCompare(b)).map(([id, tx]) => [id, {
        snapshotId: tx.snapshotId,
        totalBytes: tx.totalBytes,
        manifestByteLength: tx.manifestByteLength,
        fileCount: tx.fileCount,
        expectedActiveSnapshotId: tx.expectedActiveSnapshotId,
        status: tx.status,
        committedBytes: tx.committedBytes,
        committedFiles: Object.keys(tx.files).length,
        files: Object.fromEntries(Object.entries(tx.files).sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => [path, {
          byteLength: file.byteLength,
          chunks: file.chunks.map(({ offset, byteLength, chunkSha256 }) => ({ offset, byteLength, chunkSha256 })),
        }])),
      }]),
    );
    return {
      activeSnapshotId: this.state.activeSnapshotId,
      lastGoodSnapshotId: this.state.lastGoodSnapshotId,
      generation: this.state.generation,
      transactions,
    };
  }

  semanticDigest() {
    return digest(this.semanticState());
  }

  fullDigest() {
    return digest({
      semantic: this.semanticState(),
      requestLedger: [...this.requestLedger.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });
  }

  handle(request) {
    const fingerprint = digest({ op: request.op, payload: request.payload });
    const cached = this.requestLedger.get(request.requestId);
    if (cached) {
      if (cached.fingerprint === fingerprint) {
        return { response: clone(cached.response), replayed: true };
      }
      return {
        response: this.#error(request, "REQUEST_ID_CONFLICT", { requestId: request.requestId }),
        replayed: false,
      };
    }

    const response = this.#dispatch(request);
    if (response.ok) this.requestLedger.set(request.requestId, { fingerprint, response: clone(response) });
    return { response, replayed: false };
  }

  #dispatch(request) {
    switch (request.op) {
      case "snapshot.stage.begin": return this.#begin(request);
      case "snapshot.stage.write": return this.#write(request);
      case "snapshot.verify": return this.#verify(request);
      case "snapshot.activate": return this.#activate(request);
      case "snapshot.abort": return this.#abort(request);
      case "snapshot.rollback": return this.#rollback(request);
      default: return this.#error(request, "OPERATION_UNSUPPORTED", {});
    }
  }

  #begin(request) {
    const p = request.payload;
    const existing = this.state.transactions[p.transactionId];
    if (existing) {
      const metadata = {
        snapshotId: existing.snapshotId,
        totalBytes: existing.totalBytes,
        manifestByteLength: existing.manifestByteLength,
        fileCount: existing.fileCount,
        expectedActiveSnapshotId: existing.expectedActiveSnapshotId,
      };
      const incoming = {
        snapshotId: p.snapshotId,
        totalBytes: p.totalBytes,
        manifestByteLength: p.manifestByteLength,
        fileCount: p.fileCount,
        expectedActiveSnapshotId: p.expectedActiveSnapshotId,
      };
      if (!equal(metadata, incoming)) {
        return this.#error(request, "TRANSACTION_ID_CONFLICT", { transactionId: p.transactionId });
      }
      if (existing.status !== "Staging") {
        return this.#error(request, "INVALID_STATE", {});
      }
      return this.#ok(request, {
        transactionId: p.transactionId,
        snapshotId: existing.snapshotId,
        resumed: true,
        receivedBytes: existing.committedBytes,
        installPhase: "Staging",
      });
    }
    if (p.expectedActiveSnapshotId !== this.state.activeSnapshotId) {
      return this.#error(request, "EXPECTED_ACTIVE_MISMATCH", {
        expectedActiveSnapshotId: p.expectedActiveSnapshotId,
        actualActiveSnapshotId: this.state.activeSnapshotId,
      });
    }
    this.state.transactions[p.transactionId] = {
      snapshotId: p.snapshotId,
      totalBytes: p.totalBytes,
      manifestByteLength: p.manifestByteLength,
      fileCount: p.fileCount,
      expectedActiveSnapshotId: p.expectedActiveSnapshotId,
      status: "Staging",
      committedBytes: "0",
      files: {},
    };
    return this.#ok(request, {
      transactionId: p.transactionId,
      snapshotId: p.snapshotId,
      resumed: false,
      receivedBytes: "0",
      installPhase: "Staging",
    });
  }

  #write(request) {
    const p = request.payload;
    const tx = this.state.transactions[p.transactionId];
    if (!tx) return this.#error(request, "TRANSACTION_NOT_FOUND", { transactionId: p.transactionId });
    if (tx.status !== "Staging") return this.#error(request, "INVALID_STATE", {});

    const data = Buffer.from(p.dataBase64, "base64");
    if (data.length !== p.byteLength) {
      return this.#error(request, "MALFORMED_MESSAGE", {});
    }
    const actualHash = createHash("sha256").update(data).digest("hex");
    if (actualHash !== p.chunkSha256) {
      return this.#error(request, "CHUNK_HASH_MISMATCH", { expectedSha256: p.chunkSha256, observedSha256: actualHash });
    }

    const manifest = tx.files["manifest.json"];
    if (p.path !== "manifest.json" && (!manifest || manifest.byteLength !== tx.manifestByteLength)) {
      return this.#error(request, "INVALID_STATE", {});
    }
    if (p.path === "manifest.json" && BigInt(p.offset) + BigInt(p.byteLength) > BigInt(tx.manifestByteLength)) {
      return this.#error(request, "CHUNK_OUT_OF_RANGE", {
        transactionId: p.transactionId,
        path: p.path,
        receivedOffset: p.offset,
      });
    }

    const file = tx.files[p.path];
    const prior = file?.chunks.find((chunk) => chunk.offset === p.offset);
    if (prior) {
      if (prior.byteLength === p.byteLength && prior.chunkSha256 === p.chunkSha256 && prior.dataBase64 === p.dataBase64) {
        return this.#ok(request, {
          transactionId: p.transactionId,
          path: p.path,
          nextDurableOffset: file.byteLength,
          receivedBytes: tx.committedBytes,
          replayed: true,
        });
      }
      return this.#error(request, "CHUNK_CONFLICT", {
        transactionId: p.transactionId,
        path: p.path,
        receivedOffset: p.offset,
      });
    }

    const expectedOffset = file?.byteLength ?? "0";
    if (p.offset !== expectedOffset) {
      return this.#error(request, "OFFSET_MISMATCH", { expectedOffset, receivedOffset: p.offset });
    }
    const isNewFile = !file;
    if (isNewFile && Object.keys(tx.files).length >= tx.fileCount) {
      return this.#error(request, "CHUNK_OUT_OF_RANGE", {
        transactionId: p.transactionId,
        path: p.path,
        receivedOffset: p.offset,
      });
    }
    if (BigInt(tx.committedBytes) + BigInt(p.byteLength) > BigInt(tx.totalBytes)) {
      return this.#error(request, "CHUNK_OUT_OF_RANGE", {
        transactionId: p.transactionId,
        path: p.path,
        receivedOffset: p.offset,
      });
    }

    const target = file ?? { byteLength: "0", chunks: [] };
    target.chunks.push({
      offset: p.offset,
      byteLength: p.byteLength,
      chunkSha256: p.chunkSha256,
      dataBase64: p.dataBase64,
    });
    target.byteLength = (BigInt(target.byteLength) + BigInt(p.byteLength)).toString();
    tx.files[p.path] = target;
    tx.committedBytes = (BigInt(tx.committedBytes) + BigInt(p.byteLength)).toString();
    return this.#ok(request, {
      transactionId: p.transactionId,
      path: p.path,
      nextDurableOffset: target.byteLength,
      receivedBytes: tx.committedBytes,
      replayed: false,
    });
  }

  #verify(request) {
    const tx = this.state.transactions[request.payload.transactionId];
    if (!tx) return this.#error(request, "TRANSACTION_NOT_FOUND", { transactionId: request.payload.transactionId });
    if (tx.status !== "Staging") return this.#error(request, "INVALID_STATE", {});
    const committedFiles = Object.keys(tx.files).length;
    const manifestBytes = tx.files["manifest.json"]?.byteLength ?? "0";
    if (tx.committedBytes !== tx.totalBytes || committedFiles !== tx.fileCount || manifestBytes !== tx.manifestByteLength) {
      return this.#error(request, "STAGING_INCOMPLETE", { transactionId: request.payload.transactionId });
    }
    tx.status = "ReadyToActivate";
    return this.#ok(request, {
      transactionId: request.payload.transactionId,
      snapshotId: tx.snapshotId,
      installPhase: "ReadyToActivate",
    });
  }

  #activate(request) {
    const p = request.payload;
    const tx = this.state.transactions[p.transactionId];
    if (!tx) return this.#error(request, "TRANSACTION_NOT_FOUND", { transactionId: p.transactionId });
    if (tx.status !== "ReadyToActivate") return this.#error(request, "INVALID_STATE", {});
    if (p.expectedActiveSnapshotId !== this.state.activeSnapshotId) {
      return this.#error(request, "EXPECTED_ACTIVE_MISMATCH", {
        expectedActiveSnapshotId: p.expectedActiveSnapshotId,
        actualActiveSnapshotId: this.state.activeSnapshotId,
      });
    }
    this.state.lastGoodSnapshotId = this.state.activeSnapshotId;
    this.state.activeSnapshotId = tx.snapshotId;
    this.state.generation = (BigInt(this.state.generation) + 1n).toString();
    tx.status = "Activated";
    return this.#ok(request, {
      transactionId: p.transactionId,
      activeSnapshotId: tx.snapshotId,
      lastGoodSnapshotId: this.state.lastGoodSnapshotId,
      generation: this.state.generation,
      installPhase: "Idle",
      bootSelection: "Active",
    });
  }

  #abort(request) {
    const tx = this.state.transactions[request.payload.transactionId];
    if (!tx) return this.#error(request, "TRANSACTION_NOT_FOUND", { transactionId: request.payload.transactionId });
    if (tx.status !== "Staging" && tx.status !== "ReadyToActivate") {
      return this.#error(request, "INVALID_STATE", {});
    }
    tx.status = "Aborted";
    return this.#ok(request, {
      transactionId: request.payload.transactionId,
      aborted: true,
      activeSnapshotId: this.state.activeSnapshotId,
      installPhase: "Idle",
    });
  }

  #rollback(request) {
    const expected = request.payload.expectedActiveSnapshotId;
    if (expected !== this.state.activeSnapshotId) {
      return this.#error(request, "EXPECTED_ACTIVE_MISMATCH", {
        expectedActiveSnapshotId: expected,
        actualActiveSnapshotId: this.state.activeSnapshotId,
      });
    }
    if (!this.state.lastGoodSnapshotId || this.state.lastGoodSnapshotId === this.state.activeSnapshotId) {
      return this.#error(request, "INVALID_STATE", {});
    }
    this.state.activeSnapshotId = this.state.lastGoodSnapshotId;
    this.state.generation = (BigInt(this.state.generation) + 1n).toString();
    return this.#ok(request, {
      activeSnapshotId: this.state.activeSnapshotId,
      lastGoodSnapshotId: this.state.lastGoodSnapshotId,
      generation: this.state.generation,
      installPhase: "Idle",
      bootSelection: "LastGood",
    });
  }

  #ok(request, payload) {
    return { ...RESPONSE_BASE, requestId: request.requestId, op: request.op, ok: true, payload };
  }

  #error(request, code, detail) {
    const hasReady = Object.values(this.state.transactions).some((tx) => tx.status === "ReadyToActivate");
    const hasStaging = Object.values(this.state.transactions).some((tx) => tx.status === "Staging");
    return {
      ...RESPONSE_BASE,
      requestId: request.requestId,
      op: request.op,
      ok: false,
      error: {
        code,
        retryable: false,
        installPhase: hasReady ? "ReadyToActivate" : hasStaging ? "Staging" : "Idle",
        bootSelection: this.state.activeSnapshotId ? "Active" : "Empty",
        detail,
      },
    };
  }
}

export { canonical, digest, equal };
