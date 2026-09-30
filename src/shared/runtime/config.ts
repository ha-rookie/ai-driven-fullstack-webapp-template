export type RuntimeConfigValues = Readonly<Record<string, string | undefined>>;

export interface RuntimeConfigSources {
  readonly settings?: RuntimeConfigValues;
  readonly secrets?: RuntimeConfigValues;
}

export class RuntimeConfigError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = "RuntimeConfigError";
    this.key = key;
  }
}

const readValue = (
  source: RuntimeConfigValues | undefined,
  key: string,
): string | undefined => source?.[key];

const requireValue = (
  source: RuntimeConfigValues | undefined,
  key: string,
  kind: "setting" | "secret",
): string => {
  const value = readValue(source, key);
  if (value === undefined || value === "") {
    throw new RuntimeConfigError(key, `Required runtime ${kind} is missing: ${key}`);
  }

  return value;
};

const parsePositiveInteger = (key: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RuntimeConfigError(
      key,
      `Runtime setting must be a positive integer: ${key}`,
    );
  }

  return parsed;
};

export class RuntimeConfigReader {
  constructor(private readonly sources: RuntimeConfigSources = {}) {}

  optionalSetting(key: string): string | undefined {
    return readValue(this.sources.settings, key);
  }

  requiredSetting(key: string): string {
    return requireValue(this.sources.settings, key, "setting");
  }

  optionalSecret(key: string): string | undefined {
    return readValue(this.sources.secrets, key);
  }

  requiredSecret(key: string): string {
    return requireValue(this.sources.secrets, key, "secret");
  }

  optionalPositiveIntegerSetting(key: string): number | undefined {
    const value = this.optionalSetting(key);
    return value === undefined || value === ""
      ? undefined
      : parsePositiveInteger(key, value);
  }

  requiredPositiveIntegerSetting(key: string): number {
    return parsePositiveInteger(key, this.requiredSetting(key));
  }
}
