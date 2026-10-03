import {
  createCsvExportStream,
  type CsvExportColumn,
  type CsvExportPolicy,
} from "../../shared/tabular-data";
import { apiErrorResponse } from "./api-error";
import { createContentDisposition } from "./file-transfer";

export type CsvExportAccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly status: 401 | 403;
      readonly code: "authentication_required" | "forbidden";
      readonly message: string;
    };

export interface AuthorizedCsvExportOptions<T> {
  readonly request: Request;
  readonly requestId: string;
  readonly filename: string;
  readonly authorize: (request: Request) => Promise<CsvExportAccessDecision>;
  readonly rows: (request: Request) => Iterable<T> | AsyncIterable<T>;
  readonly columns: readonly CsvExportColumn<T>[];
  readonly policy: CsvExportPolicy;
  readonly onComplete?: (metadata: {
    readonly rowCount: number;
    readonly requestId: string;
  }) => void | Promise<void>;
}

export const createAuthorizedCsvExportResponse = async <T>({
  request,
  requestId,
  filename,
  authorize,
  rows,
  columns,
  policy,
  onComplete,
}: AuthorizedCsvExportOptions<T>): Promise<Response> => {
  const access = await authorize(request);
  if (!access.allowed) {
    return apiErrorResponse(
      {
        status: access.status,
        code: access.code,
        message: access.message,
      },
      requestId,
    );
  }

  const stream = createCsvExportStream(rows(request), columns, policy, async ({ rowCount }) => {
    await onComplete?.({ rowCount, requestId });
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": createContentDisposition(filename, "attachment"),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
};
