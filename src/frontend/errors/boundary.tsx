import {
  Component,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";

export interface ErrorBoundaryReport {
  readonly kind: "render_error";
  readonly boundaryId?: string;
  readonly correlationId?: string;
}

export interface ErrorBoundaryFallbackActions {
  readonly retry: () => void;
  readonly reload: () => void;
  readonly correlationId?: string;
}

export interface SafeErrorBoundaryProps extends PropsWithChildren {
  readonly boundaryId?: string;
  readonly correlationId?: string;
  readonly resetKey?: string | number;
  readonly fallback?: ReactNode | ((actions: ErrorBoundaryFallbackActions) => ReactNode);
  readonly onReport?: (report: ErrorBoundaryReport) => void;
  readonly onReset?: () => void;
  readonly reload?: () => void;
}

interface SafeErrorBoundaryState {
  readonly failed: boolean;
}

const containsControlCharacter = (value: string) => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
};

const safeIdentifier = (value: string | undefined, max = 128) => {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || containsControlCharacter(normalized)) return undefined;
  return normalized;
};

export const ErrorBoundaryFallback = ({
  retry,
  reload,
  correlationId,
}: ErrorBoundaryFallbackActions) => (
  <section role="alert" aria-live="assertive" data-render-error="true">
    <h2>Something went wrong</h2>
    <p>This part of the application could not be displayed safely.</p>
    {correlationId ? <p>Reference ID: {correlationId}</p> : null}
    <div>
      <button type="button" onClick={retry}>Try again</button>
      <button type="button" onClick={reload}>Reload</button>
    </div>
  </section>
);

export class SafeErrorBoundary extends Component<SafeErrorBoundaryProps, SafeErrorBoundaryState> {
  state: SafeErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): SafeErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The shared report contract intentionally excludes raw Error and component stack detail.
    void error;
    void info;
    const boundaryId = safeIdentifier(this.props.boundaryId);
    const correlationId = safeIdentifier(this.props.correlationId);
    const report: ErrorBoundaryReport = {
      kind: "render_error",
      ...(boundaryId ? { boundaryId } : {}),
      ...(correlationId ? { correlationId } : {}),
    };
    try {
      this.props.onReport?.(Object.freeze(report));
    } catch {
      // Reporting must not break the fallback boundary.
    }
  }

  componentDidUpdate(previous: SafeErrorBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  private readonly reset = () => {
    this.setState({ failed: false });
    try {
      this.props.onReset?.();
    } catch {
      // Reset remains available even if a project hook fails.
    }
  };

  private readonly reload = () => {
    if (this.props.reload) {
      this.props.reload();
      return;
    }
    if (typeof window !== "undefined") window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const correlationId = safeIdentifier(this.props.correlationId);
    const actions: ErrorBoundaryFallbackActions = {
      retry: this.reset,
      reload: this.reload,
      ...(correlationId ? { correlationId } : {}),
    };
    return typeof this.props.fallback === "function"
      ? this.props.fallback(actions)
      : this.props.fallback ?? <ErrorBoundaryFallback {...actions} />;
  }
}
