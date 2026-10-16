/**
 * #420: browse source-reference paths from the reviewed SCS mapping, not SCS evidence.
 * Paths are untrusted strings at the UI boundary; never accept a host, query, hash,
 * encoded traversal, arbitrary extension or filesystem traversal.
 */
export interface ScsTestSourceLink {
  readonly path: string;
  /** Link to the current repository main only, NOT to the deployed app or a verified check. */
  readonly href: string;
}

const REPO_SOURCE_BASE = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/";
const TEST_FILE = /^tests\/(?:[a-z0-9_-]+\/)*[a-z0-9][a-z0-9._-]*\.test\.ts$/u;
const SCRIPT_FILE = /^scripts\/(?:[a-z0-9_-]+\/)*[a-z0-9][a-z0-9._-]*\.(?:mjs|sh)$/u;
const WORKFLOW_FILE = /^\.github\/workflows\/[a-z0-9][a-z0-9._-]*\.ya?ml$/u;

const safePath = (path: string): boolean => path.length <= 160
  && !path.includes("..") && !path.includes("//")
  && (TEST_FILE.test(path) || SCRIPT_FILE.test(path) || WORKFLOW_FILE.test(path));

/**
 * A mapping's semicolon-separated test path field becomes bounded *source links*.
 * An invalid member invalidates the whole field to avoid partial trust promotion.
 */
export const scsTestSourceLinks = (reference: unknown): readonly ScsTestSourceLink[] => {
  if (typeof reference !== "string" || reference.length > 1024 || !reference.trim()) return [];
  const entries = reference.split(";");
  if (entries.length > 8) return [];
  const paths = entries.map((entry) => entry.trim());
  if (paths.some((path) => !safePath(path)) || new Set(paths).size !== paths.length) return [];
  return paths.map((path) => Object.freeze({ path, href: REPO_SOURCE_BASE + path }));
};
