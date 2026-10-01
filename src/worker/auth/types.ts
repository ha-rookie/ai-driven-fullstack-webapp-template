export type UserStatus = "active" | "disabled";

export interface UserRecord {
  id: string;
  displayName: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VerifiedExternalIdentity {
  provider: string;
  subject: string;
  displayName?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  displayName: string | null;
}

export interface ResolvedApplicationSession {
  user: AuthenticatedUser;
  expiresAt: string;
}
