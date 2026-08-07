import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import { isStrictRfc3339 } from "../../contracts/rfc3339.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function computeHostValidationRunId(run) {
  const { hostRunId: _ignored, ...identity } = run;
  return `host-run:sha256:${canonicalSha256(identity).sha256}`;
}

export function assertHostValidationRun({ run, catalog, adapters, sourceSet, reportArtifacts }) {
  assert(run.hostRunId === computeHostValidationRunId(run), "host validation run identity mismatch");
  assert(isStrictRfc3339(run.startedAt) && isStrictRfc3339(run.completedAt), "host validation run timestamp is not strict RFC3339");
  assert(Date.parse(run.completedAt) >= Date.parse(run.startedAt), "host validation run completion precedes start");
  assert(run.catalogId === catalog.catalogId, "host validation run catalog mismatch");
  assert(run.hostAdapterRegistrySha256 === catalog.hostAdapterRegistrySha256, "host validation run adapter registry mismatch");
  assert(sameJson(run.sourceSet, sourceSet), "host validation run source set is stale");
  const expected = [...adapters.adapters].sort((left, right) => left.gateId.localeCompare(right.gateId, "en"));
  assert(run.reports.length === expected.length, "host validation run report count mismatch");
  for (let index = 0; index < expected.length; index += 1) {
    const adapter = expected[index];
    const record = run.reports[index];
    assert(record.gateId === adapter.gateId && record.reportPath === adapter.reportPath, "host validation run report registry mismatch");
    assert(record.refreshedDuringRun === true, `${record.gateId} was not refreshed during the sealed host run`);
    const actual = reportArtifacts.get(record.reportPath);
    assert(actual, `host validation report is missing: ${record.reportPath}`);
    assert(actual.size === record.current.size && actual.sha256 === record.current.sha256, `host validation report drifted after seal: ${record.reportPath}`);
  }
  return run;
}
