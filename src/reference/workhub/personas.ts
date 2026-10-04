export const WORKHUB_DEMO_PASSWORD = "Workhub-Demo-2026!";

export const WORKHUB_PERSONAS = [
  {
    key: "haru",
    userId: "haru",
    internalUserId: "workhub-demo-haru",
    displayName: "Haru Newcomer",
    roleLabel: "新入社員",
    role: "newcomer",
    homeHint: "Onboarding / 必須研修",
  },
  {
    key: "aoi",
    userId: "aoi",
    internalUserId: "workhub-demo-aoi",
    displayName: "Aoi Employee",
    roleLabel: "一般社員",
    role: "employee",
    homeHint: "MY WORK / 申請",
  },
  {
    key: "ren",
    userId: "ren",
    internalUserId: "workhub-demo-ren",
    displayName: "Ren Manager",
    roleLabel: "Manager",
    role: "manager",
    homeHint: "承認Task / Team",
  },
  {
    key: "mei",
    userId: "mei",
    internalUserId: "workhub-demo-mei",
    displayName: "Mei Accounting",
    roleLabel: "経理",
    role: "accounting",
    homeHint: "経費確認Queue",
  },
  {
    key: "sora",
    userId: "sora",
    internalUserId: "workhub-demo-sora",
    displayName: "Sora Corporate",
    roleLabel: "人事 / 総務",
    role: "corporate",
    homeHint: "人事・総務Task",
  },
  {
    key: "kai",
    userId: "kai",
    internalUserId: "workhub-demo-kai",
    displayName: "Kai Admin",
    roleLabel: "System Admin",
    role: "system_admin",
    homeHint: "System Administration",
  },
] as const;

export type WorkhubPersona = (typeof WORKHUB_PERSONAS)[number];
export type WorkhubPersonaKey = WorkhubPersona["key"];

export const WORKHUB_PERSONA_BY_INTERNAL_USER_ID = new Map(
  WORKHUB_PERSONAS.map((persona) => [persona.internalUserId, persona] as const),
);
