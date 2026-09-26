import type { Logger, LogContext } from "./logger";

export class NoopLogger implements Logger {
  debug(message: string, context?: LogContext): void {
    void message;
    void context;
  }

  info(message: string, context?: LogContext): void {
    void message;
    void context;
  }

  warn(message: string, context?: LogContext): void {
    void message;
    void context;
  }

  error(message: string, context?: LogContext): void {
    void message;
    void context;
  }
}
