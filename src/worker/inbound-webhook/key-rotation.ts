import { InboundWebhookVerificationError } from "./types";

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const MAX_VERIFICATION_CANDIDATES = 4;

export interface InboundWebhookVerificationKeyReference {
  readonly keyId: string;
  readonly secretRef: string;
}

export interface InboundWebhookVerificationKeyResolver {
  resolveCandidates(input: {
    readonly providerKey: string;
    readonly receivedAt: string;
    readonly keyHint?: string;
  }): Promise<readonly InboundWebhookVerificationKeyReference[]>;
}

export const resolveInboundWebhookVerificationKeys = async (input: {
  readonly resolver: InboundWebhookVerificationKeyResolver;
  readonly providerKey: string;
  readonly receivedAt: string;
  readonly keyHint?: string;
}): Promise<readonly InboundWebhookVerificationKeyReference[]> => {
  const candidates = await input.resolver.resolveCandidates({
    providerKey: input.providerKey,
    receivedAt: input.receivedAt,
    ...(input.keyHint ? { keyHint: input.keyHint } : {}),
  });
  if (candidates.length === 0 || candidates.length > MAX_VERIFICATION_CANDIDATES) {
    throw new InboundWebhookVerificationError("verification_key_unavailable");
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!KEY_ID_PATTERN.test(candidate.keyId) || !SECRET_REF_PATTERN.test(candidate.secretRef)) {
      throw new InboundWebhookVerificationError("verification_key_invalid");
    }
    if (seen.has(candidate.keyId)) {
      throw new InboundWebhookVerificationError("verification_key_duplicate");
    }
    seen.add(candidate.keyId);
  }
  return Object.freeze(candidates.map((candidate) => Object.freeze({ ...candidate })));
};
