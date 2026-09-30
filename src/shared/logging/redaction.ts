/**
 * Pure, bounded key-based projection for structured diagnostic records.
 * This is defense in depth, not detection of secrets embedded in free-form text.
 */
export const REDACTED_LOG_VALUE = "[REDACTED]";
export const TRUNCATED_LOG_VALUE = "[TRUNCATED]";

export const LOG_REDACTION_LIMITS = Object.freeze({
  maxDepth: 4,
  maxStringLength: 256,
  maxKeyLength: 64,
  maxCollectionEntries: 20,
  maxVisitedNodes: 128,
});

const DENIED_KEYS = new Set([
  "authorization", "proxyauthorization", "cookie", "setcookie",
  "token", "accesstoken", "refreshtoken", "idtoken", "sessiontoken",
  "sessionid", "secret", "clientsecret", "password", "passwd", "pwd",
  "credential", "credentials", "apikey", "accesskey", "privatekey",
  "requestbody", "responsebody", "rawrequest", "rawresponse", "headers",
  "email", "emailaddress", "phone", "phonenumber", "address",
  "postaladdress", "ipaddress", "useragent",
]);

/** Case-insensitive; treats dashes, underscores and dots as equivalent. */
export const isSensitiveLogKey = (key: string): boolean => {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return (
    DENIED_KEYS.has(normalized) ||
    /(token|secret|password|credential|apikey|privatekey|email|phone|address)$/.test(
      normalized,
    )
  );
};

const boundedString = (value: string): string => {
  if (value.length <= LOG_REDACTION_LIMITS.maxStringLength) return value;
  return (
    value.slice(0, LOG_REDACTION_LIMITS.maxStringLength - TRUNCATED_LOG_VALUE.length) +
    TRUNCATED_LOG_VALUE
  );
};

/**
 * Return a detached JSON-safe projection, without calling accessors or toJSON.
 * Sensitive keys are replaced before their corresponding values are inspected.
 * Non-plain instances (including Error) are never introspected.
 */
export const redactLogValue = (input: unknown): unknown => {
  const ancestors = new WeakSet<object>();
  let visitedNodes = 0;

  const visit = (value: unknown, depth: number): unknown => {
    if (visitedNodes >= LOG_REDACTION_LIMITS.maxVisitedNodes) {
      return TRUNCATED_LOG_VALUE;
    }
    visitedNodes += 1;

    if (value === null) return null;
    if (typeof value === "string") return boundedString(value);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : REDACTED_LOG_VALUE;
    }
    if (typeof value !== "object") return REDACTED_LOG_VALUE;
    if (depth >= LOG_REDACTION_LIMITS.maxDepth || ancestors.has(value)) {
      return TRUNCATED_LOG_VALUE;
    }

    const isArray = Array.isArray(value);
    if (!isArray) {
      // Reject Error, Date, Map, URL, class instances and objects with custom
      // serialization methods. Callers must supply an explicit safe projection.
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return REDACTED_LOG_VALUE;
      }
    }

    ancestors.add(value);
    try {
      if (isArray) {
        const values = value as unknown[];
        const length = Math.min(values.length, LOG_REDACTION_LIMITS.maxCollectionEntries);
        const result: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
          result.push(descriptor && "value" in descriptor
            ? visit(descriptor.value, depth + 1)
            : REDACTED_LOG_VALUE);
        }
        if (values.length > length) result.push(TRUNCATED_LOG_VALUE);
        return result;
      }

      const keys = Object.keys(value);
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const length = Math.min(keys.length, LOG_REDACTION_LIMITS.maxCollectionEntries);
      for (let index = 0; index < length; index += 1) {
        const key = keys[index];
        // Do not copy any part of an oversized caller-controlled property name.
        const outputKey = key.length <= LOG_REDACTION_LIMITS.maxKeyLength
          ? key
          : `[TRUNCATED_KEY_${index}]`;
        if (isSensitiveLogKey(key)) {
          result[outputKey] = REDACTED_LOG_VALUE;
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        result[outputKey] = descriptor && "value" in descriptor
          ? visit(descriptor.value, depth + 1)
          : REDACTED_LOG_VALUE;
      }
      if (keys.length > length) result.__truncated__ = TRUNCATED_LOG_VALUE;
      return result;
    } finally {
      ancestors.delete(value);
    }
  };

  return visit(input, 0);
};
