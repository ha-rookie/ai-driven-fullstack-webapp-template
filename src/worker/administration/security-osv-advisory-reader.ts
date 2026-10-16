/**
 * #420: OSV advisory IDs for the reviewed npm runtime lock inventory only.
 * OSV is a public vulnerability index, not a full scanner or SCS assessment.
 * The global SecurityFinding feed remains disconnected until separately proven.
 */
import type { RuntimeEnvironment } from "../../shared/runtime";
import inventory from "../../../config/security-runtime-dependency-inventory.json";

const OSV_URL = "https://api.osv.dev/v1/querybatch";
const TTL_MS = 300_000;
const MAX_BYTES = 128 * 1024;
const MAX_ADVISORIES = 64;
const ADVISORY_ID = /^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-[0-9]{4}-[0-9]{4,}|OSV-[0-9]{4}-[0-9]+)$/u;

export interface RuntimeOsvAdvisory {
  readonly packageRef: string;
  readonly advisoryId: string;
}
export type RuntimeOsvResult =
  | { readonly schemaVersion: 1; readonly scope: "runtime-lock-only";
      readonly source: "OSV"; readonly state: "unavailable";
      readonly checkedAt: null; readonly checkedPackages: null;
      readonly advisoryCount: null; readonly advisories: null }
  | { readonly schemaVersion: 1; readonly scope: "runtime-lock-only";
      readonly source: "OSV"; readonly state: "verified";
      readonly checkedAt: string; readonly checkedPackages: number;
      readonly advisoryCount: number; readonly advisories: readonly RuntimeOsvAdvisory[] };

export type RuntimeOsvReader = (
  environment: RuntimeEnvironment, checkedAt: string,
) => Promise<RuntimeOsvResult>;

const unavailable = (): RuntimeOsvResult => ({
  schemaVersion: 1, scope: "runtime-lock-only", source: "OSV",
  state: "unavailable", checkedAt: null, checkedPackages: null,
  advisoryCount: null, advisories: null,
});

const plain = (data: unknown): Record<string, unknown> => {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.getPrototypeOf(data) !== Object.prototype) {
    throw new TypeError("Unexpected OSV object");
  }
  return data as Record<string, unknown>;
};
const controlledJson = async (response: Response): Promise<unknown> => {
  if (!response.ok || response.redirected
    || !response.headers.get("content-type")?.includes("application/json")
    || (response.headers.has("content-length")
      && Number(response.headers.get("content-length")) > MAX_BYTES)
    || !response.body) {
    // Never wait for cancel() of a tee/clone: another unread branch can deadlock it.
    void response.body?.cancel().catch(() => {});
    throw new TypeError("OSV unavailable");
  }
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new RangeError("OSV reply too large");
      pieces.push(value);
    }
  } catch (error) {
    // Bound the response without blocking forever on a cloned stream.
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of pieces) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};

const validateInventory = (): void => {
  if (inventory.schemaVersion !== 1 || inventory.scope !== "runtime-lock-only"
    || inventory.lockfileVersion !== 3 || inventory.packages.length !== 12) {
    throw new TypeError("Unreviewed OSV runtime inventory");
  }
  const paths = new Set<string>();
  const refs = new Set<string>();
  for (const item of inventory.packages) {
    if (!/^pkg_[0-9]{2}$/u.test(item.ref) || !item.path.startsWith("node_modules/")
      || !/^(?:@[-a-z0-9._]+\/)?[-a-z0-9._]+$/u.test(item.name)
      || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(item.version)
      || paths.has(item.path) || refs.has(item.ref)) {
      throw new TypeError("Unsafe runtime package inventory");
    }
    paths.add(item.path); refs.add(item.ref);
  }
};

const project = (data: unknown, checkedAt: string): RuntimeOsvResult => {
  const root = plain(data);
  if (!Array.isArray(root.results)
    || root.results.length !== inventory.packages.length) {
    throw new TypeError("Incomplete OSV results");
  }
  const result: RuntimeOsvAdvisory[] = [];
  for (const [index, value] of root.results.entries()) {
    const entry = plain(value);
    // A partial/paginated result may not be represented as complete evidence.
    if ("next_page_token" in entry
      || Object.keys(entry).some(key => key !== "vulns")) {
      throw new TypeError("Incomplete/unknown OSV result");
    }
    const vulns: unknown = entry.vulns ?? [];
    if (!Array.isArray(vulns) || vulns.length > MAX_ADVISORIES) {
      throw new TypeError("Invalid OSV vulnerability list");
    }
    const seen = new Set<string>();
    for (const item of vulns) {
      const advisory = plain(item);
      if (typeof advisory.id !== "string" || !ADVISORY_ID.test(advisory.id)
        || typeof advisory.modified !== "string"
        || !Number.isFinite(Date.parse(advisory.modified))
        || seen.has(advisory.id)) {
        throw new TypeError("Untrusted OSV advisory");
      }
      seen.add(advisory.id);
      result.push({
        packageRef: inventory.packages[index].ref,
        advisoryId: advisory.id,
      });
      if (result.length > MAX_ADVISORIES) throw new RangeError("OSV result truncated");
    }
  }
  return {
    schemaVersion: 1, scope: "runtime-lock-only", source: "OSV",
    state: "verified", checkedAt,
    checkedPackages: inventory.packages.length,
    advisoryCount: result.length, advisories: result,
  };
};

export const createRuntimeOsvReader = (fetcher: typeof fetch = fetch): RuntimeOsvReader => {
  let cache: { at: number; data: RuntimeOsvResult } | undefined;
  let pending: Promise<RuntimeOsvResult> | undefined;
  return async (environment, asOf) => {
    // No network calls from local/unit tests or unsupported environments.
    if (environment === "local" || environment === "test") return unavailable();
    if (environment !== "preview" && environment !== "production") return unavailable();
    const at = Date.parse(asOf);
    if (!Number.isFinite(at) || new Date(at).toISOString() !== asOf) return unavailable();
    if (cache && at >= cache.at && at - cache.at < TTL_MS) return cache.data;
    if (pending) return pending;
    pending = (async (): Promise<RuntimeOsvResult> => {
      try {
        validateInventory();
        const response = await fetcher(OSV_URL, {
          method: "POST", redirect: "error", credentials: "omit",
          signal: AbortSignal.timeout(12_000),
          headers: { "accept": "application/json", "content-type": "application/json" },
          body: JSON.stringify({ queries: inventory.packages.map(item => ({
            version: item.version, package: { name: item.name, ecosystem: "npm" },
          })) }),
        });
        const result = project(await controlledJson(response), asOf);
        cache = { at, data: result };
        return result;
      } catch {
        const result = unavailable();
        cache = { at, data: result };
        return result;
      }
    })();
    try { return await pending; } finally { pending = undefined; }
  };
};

export const readRuntimeOsvAdvisories = createRuntimeOsvReader();
