import { systemClock, type Clock, isRuntimeEnvironment, type RuntimeEnvironment } from "../runtime";

export type MetricsEnvironment = RuntimeEnvironment | "unknown";

export const APPLICATION_METRIC_NAMES = [
  "http_request_count",
  "http_request_duration_ms",
  "http_error_count",
  "dependency_failure_count",
] as const;

export type ApplicationMetricName = (typeof APPLICATION_METRIC_NAMES)[number];
export type MetricUnit = "count" | "milliseconds";
export type HttpMethodDimension = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "OTHER";
export type HttpStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

export interface MetricLabels {
  readonly environment: MetricsEnvironment;
  readonly component: string;
  readonly route?: string;
  readonly method?: HttpMethodDimension;
  readonly statusClass?: HttpStatusClass;
  readonly errorCategory?: string;
  readonly dependency?: string;
  readonly operation?: string;
}

export interface MetricCorrelation {
  readonly requestId?: string;
}

export interface ApplicationMetricSample {
  readonly kind: "metric";
  readonly timestamp: string;
  readonly name: ApplicationMetricName;
  readonly value: number;
  readonly unit: MetricUnit;
  readonly labels: MetricLabels;
  /** Correlation context is intentionally separate from aggregation labels. */
  readonly correlation?: MetricCorrelation;
}

export type ApplicationMetricSink = (sample: ApplicationMetricSample) => void;

export const consoleApplicationMetricSink: ApplicationMetricSink = (sample) => {
  console.log(JSON.stringify(sample));
};

const DIMENSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The baseline deliberately rejects slashes, whitespace and free-form text so raw URLs,
 * path parameters and user-provided labels are not accidentally promoted to dimensions.
 */
export const isSafeMetricDimension = (value: unknown): value is string =>
  typeof value === "string" && DIMENSION_PATTERN.test(value);

export const isSafeMetricCorrelationId = (value: unknown): value is string =>
  typeof value === "string" && CORRELATION_PATTERN.test(value);

const requireDimension = (value: unknown, field: string): string => {
  if (!isSafeMetricDimension(value)) {
    throw new TypeError(`${field} must be a declared low-cardinality metric dimension`);
  }
  return value;
};

export const toMetricsEnvironment = (value: unknown): MetricsEnvironment =>
  isRuntimeEnvironment(value) ? value : "unknown";

export const toHttpMethodDimension = (method: string): HttpMethodDimension => {
  switch (method.toUpperCase()) {
    case "GET":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
    case "HEAD":
    case "OPTIONS":
      return method.toUpperCase() as HttpMethodDimension;
    default:
      return "OTHER";
  }
};

export const toHttpStatusClass = (status: number): HttpStatusClass => {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RangeError("HTTP status must be between 100 and 599");
  }
  return `${Math.floor(status / 100)}xx` as HttpStatusClass;
};

const defaultMonotonicNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export interface ApplicationMetricsRecorderOptions {
  readonly environment: MetricsEnvironment;
  readonly component: string;
  readonly sink?: ApplicationMetricSink;
  readonly clock?: Clock;
  readonly monotonicNow?: () => number;
}

export interface StartRequestMetricInput {
  readonly route: string;
  readonly method: string;
  readonly requestId?: string;
}

export interface CompleteRequestMetricOptions {
  readonly errorCategory?: string;
}

export interface RequestMetricObservation {
  complete(status: number, options?: CompleteRequestMetricOptions): void;
}

export interface DependencyFailureMetricInput {
  readonly dependency: string;
  readonly operation: string;
  readonly requestId?: string;
}

const correlationFor = (requestId: string | undefined): MetricCorrelation | undefined =>
  isSafeMetricCorrelationId(requestId) ? Object.freeze({ requestId }) : undefined;

const freezeLabels = (labels: MetricLabels): MetricLabels => Object.freeze(labels);

/**
 * Provider-neutral runtime metrics recorder.
 *
 * It emits safe samples only and treats a broken sink as non-fatal. The recorder has no
 * aggregation, retention, SLO or external SaaS dependency; those are Project/exporter concerns.
 */
export class ApplicationMetricsRecorder {
  private readonly environment: MetricsEnvironment;
  private readonly component: string;
  private readonly sink: ApplicationMetricSink;
  private readonly clock: Clock;
  private readonly monotonicNow: () => number;

  constructor(options: ApplicationMetricsRecorderOptions) {
    this.environment = options.environment;
    this.component = requireDimension(options.component, "component");
    this.sink = options.sink ?? consoleApplicationMetricSink;
    this.clock = options.clock ?? systemClock;
    this.monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
  }

  startRequest(input: StartRequestMetricInput): RequestMetricObservation {
    const route = requireDimension(input.route, "route");
    const method = toHttpMethodDimension(input.method);
    const correlation = correlationFor(input.requestId);
    const startedAt = this.monotonicNow();
    let completed = false;

    return Object.freeze({
      complete: (status: number, options: CompleteRequestMetricOptions = {}) => {
        if (completed) return;
        completed = true;

        const statusClass = toHttpStatusClass(status);
        const labels = freezeLabels({
          environment: this.environment,
          component: this.component,
          route,
          method,
          statusClass,
        });
        const durationMs = Math.max(0, this.monotonicNow() - startedAt);

        this.emit("http_request_count", 1, "count", labels, correlation);
        this.emit("http_request_duration_ms", durationMs, "milliseconds", labels, correlation);

        if (status >= 400) {
          const errorCategory = options.errorCategory
            ? requireDimension(options.errorCategory, "errorCategory")
            : status >= 500 ? "server_error" : "client_error";
          this.emit(
            "http_error_count",
            1,
            "count",
            freezeLabels({ ...labels, errorCategory }),
            correlation,
          );
        }
      },
    });
  }

  recordDependencyFailure(input: DependencyFailureMetricInput): void {
    const labels = freezeLabels({
      environment: this.environment,
      component: this.component,
      dependency: requireDimension(input.dependency, "dependency"),
      operation: requireDimension(input.operation, "operation"),
    });
    this.emit("dependency_failure_count", 1, "count", labels, correlationFor(input.requestId));
  }

  private emit(
    name: ApplicationMetricName,
    value: number,
    unit: MetricUnit,
    labels: MetricLabels,
    correlation?: MetricCorrelation,
  ): void {
    if (!Number.isFinite(value) || value < 0) return;
    try {
      this.sink(Object.freeze({
        kind: "metric",
        timestamp: this.clock.now().toISOString(),
        name,
        value,
        unit,
        labels,
        ...(correlation ? { correlation } : {}),
      }));
    } catch {
      // Metrics are best-effort and must not alter business behavior.
    }
  }
}
