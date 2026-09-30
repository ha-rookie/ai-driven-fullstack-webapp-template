import { systemClock, type Clock } from "../runtime";
import { redactLogValue } from "./redaction";
import type { LogContext, Logger } from "./logger";

export type ApplicationLogLevel = "debug" | "info" | "warn" | "error";

export interface SafeApplicationLogError {
  readonly name: string;
}

export interface StructuredApplicationLogRecord {
  readonly kind: "application";
  readonly timestamp: string;
  readonly level: ApplicationLogLevel;
  readonly component: string;
  readonly message: string;
  readonly requestId?: string;
  readonly actorId?: string;
  readonly scopeId?: string;
  readonly error?: SafeApplicationLogError;
}

export type ApplicationLogSink = (level: ApplicationLogLevel, line: string) => void;

/** The baseline writes one JSON line per event, without an external logging service. */
export const consoleApplicationLogSink: ApplicationLogSink = (level, line) => {
  console[level](line);
};

type SafeContext = Readonly<{
  requestId?: string;
  actorId?: string;
  scopeId?: string;
}>;

// Context remains allowlisted even after #65: free-form metadata is not permitted.
const safeIdentifier = (value: unknown): string | undefined =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : undefined;

const projectSafeContext = (context?: LogContext): SafeContext => {
  if (!context) return {};

  const projected: { requestId?: string; actorId?: string; scopeId?: string } = {};
  for (const key of ["requestId", "actorId", "scopeId"] as const) {
    // Own properties only: a prototype cannot silently add log metadata.
    if (Object.hasOwn(context, key)) {
      const value = safeIdentifier(context[key]);
      if (value !== undefined) projected[key] = value;
    }
  }
  return projected;
};

const STANDARD_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

/** Avoid leaking Error.message, stack, cause, custom fields or thrown values. */
const projectSafeError = (value: unknown): SafeApplicationLogError | undefined => {
  if (!(value instanceof Error)) return undefined;
  return {
    name: STANDARD_ERROR_NAMES.has(value.name) ? value.name : "Error",
  };
};

/**
 * Application diagnostics, intentionally separate from AuditEvent and its sink.
 * Context allowlisting is enforced before shared output redaction.
 */
export class StructuredApplicationLogger implements Logger {
  constructor(
    private readonly component: string,
    private readonly sink: ApplicationLogSink = consoleApplicationLogSink,
    private readonly clock: Clock = systemClock,
    private readonly scope: SafeContext = {},
  ) {}

  /** Return a new immutable request-scoped logger; do not mutate shared instances. */
  withContext(context: LogContext): StructuredApplicationLogger {
    try {
      return new StructuredApplicationLogger(this.component, this.sink, this.clock, {
        ...this.scope,
        ...projectSafeContext(context),
      });
    } catch {
      // Even malformed/getter-bearing log context cannot fail business logic.
      return new StructuredApplicationLogger(this.component, this.sink, this.clock, this.scope);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.emit("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.emit("error", message, context);
  }

  private emit(level: ApplicationLogLevel, message: string, context?: LogContext): void {
    try {
      const record: StructuredApplicationLogRecord = {
        kind: "application",
        timestamp: this.clock.now().toISOString(),
        level,
        component: this.component,
        message,
        ...this.scope,
        ...projectSafeContext(context),
        ...(context && Object.hasOwn(context, "error")
          ? (() => {
              const error = projectSafeError(context.error);
              return error ? { error } : {};
            })()
          : {}),
      };
      // The original record never reaches JSON.stringify or the sink.
      this.sink(level, JSON.stringify(redactLogValue(record)));
    } catch {
      // Application logging is best-effort; failed sinks never change HTTP results.
    }
  }
}
