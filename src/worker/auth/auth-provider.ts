import type { VerifiedExternalIdentity } from "./types";

export interface AuthProvider<Credential = unknown> {
  readonly provider: string;
  verify(credential: Credential): Promise<VerifiedExternalIdentity>;
}
