import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { ConfirmationTrustError } from "../../contracts/confirmation-trust-v1.mjs";
import { isStrictRfc3339 } from "../../contracts/rfc3339.mjs";

export async function loadConfirmationTrustSchemaValidator(repoRoot) {
  const trustRoot = path.join(repoRoot, "hardware/evt0/confirmation-trust-v1");
  const familyRoot = path.join(repoRoot, "hardware/evt0/family-repository-v1");
  const alphaRoot = path.join(repoRoot, "hardware/evt0/family-alpha-v1");
  const trustNames = ["trust-policy", "challenge", "presentation-transcript", "proof", "verification-result", "replay-ledger", "evidence-lock"];
  const [common, request, plan, authorization, preview, confirmation, ...trustSchemas] = await Promise.all([
    readFile(path.join(trustRoot, "common.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(familyRoot, "build-request.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(familyRoot, "build-plan.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(familyRoot, "build-authorization.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(alphaRoot, "preview.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(alphaRoot, "confirmation.schema.json"), "utf8").then(JSON.parse),
    ...trustNames.map((name) => readFile(path.join(trustRoot, `${name}.schema.json`), "utf8").then(JSON.parse)),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat("date-time", { type: "string", validate: isStrictRfc3339 });
  ajv.addSchema(common);
  ajv.addSchema(request);
  for (const schema of trustSchemas) ajv.addSchema(schema);
  ajv.addSchema(plan);
  ajv.addSchema(authorization);
  const validators = new Map([
    ...trustNames.map((name, index) => [name, ajv.getSchema(trustSchemas[index].$id)]),
    ["build-plan", ajv.getSchema(plan.$id)],
    ["build-authorization", ajv.getSchema(authorization.$id)],
    ["preview", ajv.compile(preview)],
    ["confirmation", ajv.compile(confirmation)],
  ]);
  return Object.freeze({
    validate(name, value) {
      const validator = validators.get(name);
      if (!validator) throw new ConfirmationTrustError("CONFIRMATION_PROVIDER_MISCONFIGURED", `unknown confirmation schema ${name}`);
      if (!validator(value)) {
        const details = (validator.errors ?? []).map((error) => ({
          path: error.instancePath || "/",
          keyword: error.keyword,
          message: error.message,
        }));
        throw new ConfirmationTrustError("CONFIRMATION_MALFORMED", `${name} schema failed`, { errors: details });
      }
      return value;
    },
    validator(name) { return validators.get(name) ?? null; },
  });
}
