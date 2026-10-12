import { WORKHUB_PERSONAS } from "./personas";

/**
 * Stage3 WORKHUB People Reference.
 * This is an explicit public-display projection of fictitious demo personas.
 * A server must check current authenticated scope membership before serving it.
 * Do not serialize credentials, login IDs, internal principal IDs, or contact data.
 */
export interface WorkhubDirectoryPerson {
  readonly displayName: string;
  readonly roleLabel: string;
  readonly organizationLabel: string;
}

export const listWorkhubReferencePeople = (): readonly WorkhubDirectoryPerson[] =>
  WORKHUB_PERSONAS.map(({ displayName, roleLabel }) => ({
    displayName,
    roleLabel,
    organizationLabel: "CECIL WORKS株式会社（デモ）",
  }));
