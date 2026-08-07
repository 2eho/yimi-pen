import { createPublicKey, verify } from "node:crypto";
import {
  CONFIRMATION_ALGORITHM,
  CONFIRMATION_SIGNATURE_PROFILE,
  ConfirmationTrustError,
} from "../../contracts/confirmation-trust-v1.mjs";

export function verifyEd25519JcsPrefix({
  algorithm,
  signatureProfile,
  signingInput,
  signature,
  publicJwk,
}) {
  if (algorithm !== CONFIRMATION_ALGORITHM || signatureProfile !== CONFIRMATION_SIGNATURE_PROFILE) {
    throw new ConfirmationTrustError(
      "CONFIRMATION_PROFILE_UNSUPPORTED",
      "Ed25519 verifier received an unsupported algorithm profile",
    );
  }
  const exactJwk = {
    kty: publicJwk?.kty,
    crv: publicJwk?.crv,
    x: publicJwk?.x,
  };
  if (exactJwk.kty !== "OKP" || exactJwk.crv !== "Ed25519" || typeof exactJwk.x !== "string") {
    throw new ConfirmationTrustError("CONFIRMATION_POLICY_INVALID", "trusted key is not an Ed25519 public JWK");
  }
  const key = createPublicKey({ key: exactJwk, format: "jwk" });
  return verify(null, Buffer.from(signingInput), key, Buffer.from(signature));
}
