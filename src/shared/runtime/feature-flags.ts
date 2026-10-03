import { RuntimeConfigReader } from "./config";
import type { RuntimeEnvironment } from "./environment";

const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export interface FeatureFlagDefinition {
  readonly defaultValue?: boolean;
}

export type FeatureFlagDefinitions<K extends string = string> = Readonly<
  Record<K, Readonly<FeatureFlagDefinition>>
>;

export type FeatureFlagDecisionSource = "configured" | "default";

export interface FeatureFlagDecision<K extends string = string> {
  readonly key: K;
  readonly environment: RuntimeEnvironment;
  readonly enabled: boolean;
  readonly source: FeatureFlagDecisionSource;
  readonly settingKey: string;
}

export interface FeatureFlagProvider<K extends string = string> {
  isEnabled(key: K): boolean;
  evaluate(key: K): FeatureFlagDecision<K>;
}

export type FeatureFlagErrorCode =
  | "invalid_key"
  | "unknown_key"
  | "invalid_value";

export class FeatureFlagError extends Error {
  constructor(
    readonly code: FeatureFlagErrorCode,
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "FeatureFlagError";
  }
}

const assertFeatureFlagKey = (key: string): void => {
  if (!FEATURE_FLAG_KEY_PATTERN.test(key)) {
    throw new FeatureFlagError(
      "invalid_key",
      key,
      "Feature flag keys must use lower_snake_case",
    );
  }
};

export const defineFeatureFlags = <const K extends string>(
  definitions: Record<K, FeatureFlagDefinition>,
): FeatureFlagDefinitions<K> => {
  const normalized = {} as Record<K, Readonly<FeatureFlagDefinition>>;

  for (const key of Object.keys(definitions) as K[]) {
    assertFeatureFlagKey(key);
    normalized[key] = Object.freeze({
      defaultValue: definitions[key].defaultValue ?? false,
    });
  }

  return Object.freeze(normalized);
};

export const toFeatureFlagSettingKey = (
  environment: RuntimeEnvironment,
  key: string,
): string => {
  assertFeatureFlagKey(key);
  return `FEATURE_FLAG__${environment.toUpperCase()}__${key.toUpperCase()}`;
};

const parseConfiguredBoolean = (key: string, value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new FeatureFlagError(
    "invalid_value",
    key,
    `Feature flag setting must be true or false: ${key}`,
  );
};

export interface EnvironmentFeatureFlagProviderOptions<K extends string> {
  readonly environment: RuntimeEnvironment;
  readonly config: RuntimeConfigReader;
  readonly definitions: FeatureFlagDefinitions<K>;
}

export class EnvironmentFeatureFlagProvider<K extends string>
  implements FeatureFlagProvider<K>
{
  constructor(
    private readonly options: EnvironmentFeatureFlagProviderOptions<K>,
  ) {}

  evaluate(key: K): FeatureFlagDecision<K> {
    if (!Object.prototype.hasOwnProperty.call(this.options.definitions, key)) {
      throw new FeatureFlagError(
        "unknown_key",
        key,
        `Unknown feature flag key: ${key}`,
      );
    }

    const definition = this.options.definitions[key];
    const settingKey = toFeatureFlagSettingKey(this.options.environment, key);
    const configuredValue = this.options.config.optionalSetting(settingKey);

    if (configuredValue === undefined || configuredValue.trim() === "") {
      return {
        key,
        environment: this.options.environment,
        enabled: definition.defaultValue ?? false,
        source: "default",
        settingKey,
      };
    }

    return {
      key,
      environment: this.options.environment,
      enabled: parseConfiguredBoolean(settingKey, configuredValue),
      source: "configured",
      settingKey,
    };
  }

  isEnabled(key: K): boolean {
    return this.evaluate(key).enabled;
  }
}

export const createEnvironmentFeatureFlagProvider = <K extends string>(
  options: EnvironmentFeatureFlagProviderOptions<K>,
): FeatureFlagProvider<K> => new EnvironmentFeatureFlagProvider(options);
