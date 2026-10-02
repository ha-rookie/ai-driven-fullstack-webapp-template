import { OperationBudgetRecorder } from "../shared/performance/operation-budget";

type D1MetaLike = {
  rows_read?: number;
  rows_written?: number;
};

const metric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const metadataOf = (result: unknown): D1MetaLike | null => {
  if (!result || typeof result !== "object") return null;
  const meta = (result as { meta?: unknown }).meta;
  return meta && typeof meta === "object" ? meta as D1MetaLike : null;
};

const recordResult = (recorder: OperationBudgetRecorder, result: unknown, statements = 1) => {
  const meta = metadataOf(result);
  recorder.recordD1({ statements, rowsRead: metric(meta?.rows_read), rowsWritten: metric(meta?.rows_written) });
};

const recordFailure = (recorder: OperationBudgetRecorder, statements = 1) => {
  recorder.recordD1({ statements, rowsRead: null, rowsWritten: null, failed: true });
};

export function instrumentD1Database(db: D1Database, recorder: OperationBudgetRecorder): D1Database {
  const rawStatements = new WeakMap<object, D1PreparedStatement>();

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement as object, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement((statement.bind as (...args: unknown[]) => D1PreparedStatement)(...values));
        }
        if (property === "first" || property === "raw") {
          return async (...args: unknown[]) => {
            try {
              const result = await (Reflect.get(target, property) as (...values: unknown[]) => Promise<unknown>).apply(statement, args);
              recorder.recordD1({ statements: 1, rowsRead: null, rowsWritten: null });
              return result;
            } catch (error) {
              recordFailure(recorder);
              throw error;
            }
          };
        }
        if (property === "all" || property === "run") {
          return async (...args: unknown[]) => {
            try {
              const result = await (Reflect.get(target, property) as (...values: unknown[]) => Promise<unknown>).apply(statement, args);
              recordResult(recorder, result);
              return result;
            } catch (error) {
              recordFailure(recorder);
              throw error;
            }
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(statement) : value;
      },
    }) as D1PreparedStatement;
    rawStatements.set(proxy as object, statement);
    return proxy;
  };

  const unwrap = (statement: D1PreparedStatement) => rawStatements.get(statement as object) ?? statement;

  const wrapBatch = async (owner: { batch: (statements: D1PreparedStatement[]) => Promise<unknown[]> }, statements: D1PreparedStatement[]) => {
    const raw = statements.map(unwrap);
    try {
      const results = await owner.batch(raw);
      if (results.length === 0) recorder.recordD1({ statements: raw.length, rowsRead: null, rowsWritten: null });
      else {
        for (const result of results) recordResult(recorder, result);
        if (results.length < raw.length) recorder.recordD1({ statements: raw.length - results.length, rowsRead: null, rowsWritten: null });
      }
      return results;
    } catch (error) {
      recordFailure(recorder, raw.length);
      throw error;
    }
  };

  const wrapSession = (session: D1DatabaseSession): D1DatabaseSession => new Proxy(session as object, {
    get(target, property) {
      if (property === "prepare") return (query: string) => wrapStatement(session.prepare(query));
      if (property === "batch") return (statements: D1PreparedStatement[]) => wrapBatch(session, statements);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(session) : value;
    },
  }) as D1DatabaseSession;

  return new Proxy(db as object, {
    get(target, property) {
      if (property === "prepare") return (query: string) => wrapStatement(db.prepare(query));
      if (property === "batch") return (statements: D1PreparedStatement[]) => wrapBatch(db, statements);
      if (property === "exec") {
        return async (query: string) => {
          try {
            const result = await db.exec(query);
            recorder.recordD1({ statements: 1, rowsRead: null, rowsWritten: null });
            return result;
          } catch (error) {
            recordFailure(recorder);
            throw error;
          }
        };
      }
      if (property === "withSession") {
        return (...args: unknown[]) => wrapSession((db.withSession as (...values: unknown[]) => D1DatabaseSession)(...args));
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(db) : value;
    },
  }) as D1Database;
}
