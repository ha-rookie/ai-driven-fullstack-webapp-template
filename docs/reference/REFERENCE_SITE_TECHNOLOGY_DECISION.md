# Reference Site — technology and hosting decision (Issue #433)

Status: **proposed for review; not deployed**. Scope: the existing Reference Site, not a new product or WORKHUB rewrite.

## Decision

Use the repository's existing **React + TypeScript + Vite** toolchain for the first Reference Site implementation, and **Cloudflare Workers static assets** using the existing deployment setup when a separately approved Preview deployment is needed. Build the Reference pages as public, read-only content, without D1, authentication, new service bindings, or a second application runtime.

Do not add Astro, Docusaurus, Next.js, a CMS, a search service, or a new Cloudflare resource for the initial showcase. They would add dependencies and operational overhead without demonstrating a missing capability in the current acceptance scope. Reconsider only if actual documentation volume, indexing, or maintenance evidence warrants it.

## Existing assets to reuse

- `src/reference/showcase/WorkhubShowcase.tsx` and existing `/showcase` entry for the working demo.
- `src/reference/workhub/DeveloperReferencePanel.tsx` and `docs/reference/WORKHUB_DEVELOPER_GUIDE.md` for developer entry.
- `docs/README.md`, `docs/recipes/`, `docs/FULLSTACK_ARCHITECTURE.md` and other existing design documents.
- `config/work-selection-policy.json` for the current work focus and GitHub Issue #132 for the authoritative roadmap.

The first Reference Site must connect **Docs → WORKHUB Demo → Source** with stable repository links. Never label a capability as production-verified based solely on local CI or showcase simulation.

## Minimal implementation sequence (existing #433 Completion Gate unchanged)

1. Use existing #433 information architecture, metadata, capability, scenario, and status contracts; freeze only the initial publication subset.
2. Build a small public reference navigation in the existing Vite app: Overview, Getting Started, Capabilities, Architecture, Operations, and Status. Link to existing docs rather than copying them into another maintained source.
3. Wire representative capabilities to existing `/showcase` and specific GitHub source/docs URLs. Avoid a second WORKHUB demo.
4. Run focused route/link and accessibility checks, plus the mandatory PR validation. Keep formal device/system testing under #694.
5. Review #433's **original 14 Completion Gate items independently**. A passing CI run or a documentation decision alone is not equivalent to a released Reference Site.

## Hosting boundary

The repository's existing Workers/Vite static-asset hosting is the proposed target; this PR does **not** deploy anything. Production publishing, Preview deployment, D1, migrations, secrets, Cloudflare resources, and future PR merges remain separate Human Gates.

## Alternatives and reason for deferral

| Option | Benefit | Cost/concern | Decision |
| --- | --- | --- | --- |
| Existing React/Vite + Workers assets | Reuses build, deployment, styling, demo links | Must implement simple documentation navigation | **Select** |
| Docusaurus | Documentation navigation and search features | Additional framework, content migration and duplicated deployment flow | Defer |
| Astro | Static-content-first delivery | Second framework and integration overhead for an already running Vite application | Defer |
| Next.js | SSR and advanced routing | Unnecessary runtime/hosting complexity for read-only reference | Defer |

No changes to #132 WBS, milestones, priorities, or #433 original acceptance criteria.
