export const RUNTIME_ENVIRONMENTS = [
  "local",
  "test",
  "preview",
  "production",
] as const;

export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

export class RuntimeEnvironmentError extends Error {
  constructor() {
    super("Runtime environment is invalid");
    this.name = "RuntimeEnvironmentError";
  }
}

export const isRuntimeEnvironment = (
  value: unknown,
): value is RuntimeEnvironment =>
  typeof value === "string" &&
  RUNTIME_ENVIRONMENTS.includes(value as RuntimeEnvironment);

export const parseRuntimeEnvironment = (value: unknown): RuntimeEnvironment => {
  if (!isRuntimeEnvironment(value)) {
    throw new RuntimeEnvironmentError();
  }

  return value;
};

export const isProductionEnvironment = (
  environment: RuntimeEnvironment,
): boolean => environment === "production";
