# Release Evidence Bundle

## Responsibility

Issue #112 generates a release-scoped read-only index over existing Production workflow evidence. It does not deploy, migrate, execute smoke, rollback, restore data, publish a Release or replace an approval. Runtime Evidence Status (#58) describes current capability status; this bundle describes one historical release and does not prove the SHA is still serving traffic.

The existing deploy, migration, schema, smoke, rollback and supply-chain producers remain authoritative. The generator uses GitHub GET requests only, with `actions: read` / `contents: read`, and never requests Cloudflare credentials or a Production binding. Ordinary PR CI runs offline self-tests only.

## Invocation and artifact policy

After separately approved operations have produced evidence, a Project operator may manually run the `Release evidence bundle` workflow with a release identifier, full immutable deployed SHA and selected GitHub run IDs. Alternatively use:

```bash
npm run release-evidence:bundle -- --repository=OWNER/REPOSITORY --release-id=release-001 --deployed-sha=FULL_40_CHARACTER_SHA --deploy-run=DEPLOY_RUN_ID --smoke-run=SMOKE_RUN_ID --migration-run=MIGRATION_RUN_ID --output=.evidence/release-bundle.json
```

`GITHUB_TOKEN` needs read access to the selected repository's Actions; do not put its value in arguments or logs. `--rollback-run` and comma-separated `--supply-runs` are optional references. Omitting a run does not assert the operation was unnecessary or did not occur: its evidence stays unverified. The output is generated JSON, not a source to edit by hand. The manual workflow uploads only that projected JSON, retains it for 14 days, and fails if the evidence set is incomplete. Projects needing longer retention must choose approved private storage and access/retention policy; GitHub retention/expiration is a limitation, not success.

## Provenance and status

Each source is fetched from the configured repository's GitHub Actions API. Run ID, repository, workflow path and event are checked; successful job steps, artifact identity/expiration and bounded producer files are inspected. References are constructed from validated numeric identifiers, never copied from input URLs. Deployed SHA comes from the explicit release request and must match the deploy manifest. The deployment actor and timestamp come from that verified run and deploy step, not caller-entered metadata.

Migration evidence adds a narrow `production-migration.json` manifest after the existing post-migration schema verification succeeds. It binds target SHA, workflow run, environment and safe applied migration names. It introduces no new remote command or changed approval. Older runs without this manifest can still be located through workflow references but cannot establish a verified migration/SHA association. Schema snapshots, database identifiers, recovery bookmarks, SQL queries and raw migration logs are never copied to the bundle.

States are `verified`, `failed` or `unverified`. Missing/expired artifacts, incomplete/skipped steps, unsupported workflow/event, inaccessible GitHub evidence, malformed input and SHA/environment/repository/run mismatches must never become verified. Security validation is taken from the actual deploy job's Production validation step; the independent policy/self-test workflow is not remote Production evidence. Smoke must belong to the deployed SHA and contain all required policy checks, correct HTTP statuses and successful results. Optional authenticated smoke is reported separately and is not implied by unauthenticated checks.

Rollback remains a separate operation. A supplied rollback artifact must identify the original deployed SHA, previous stable SHA, rollback target, run and verified post-rollback smoke. The bundle records the final rollback target and stable marker as historical evidence; it never moves a stable tag. Without rollback evidence the generator does not invent a previous stable SHA or assert no rollback occurred. `complete` applies only to the required deploy/security/migration/schema/smoke evidence; optional rollback/supply-chain uncertainties remain visible and are not required merely to make an ordinary release's evidence set complete. Every unverified group is listed explicitly. Even complete evidence is not Human release approval, an organization exercise or proof of live data integrity.

## Safe projection and limits

Bundle fields include schemaVersion, opaque release identifier, repository, deployed SHA, fixed Production environment, bounded deployment actor/time, generated time, each evidence state and generated run/job/artifact references. Only known safe modes/status codes/check identifiers, immutable SHAs and migration filenames are summarized. Rollback reasons, secrets/tokens/Cookies, provider configuration, origin URLs, arbitrary error text, request bodies, private data and unnecessary personal information are excluded. Supply-chain evidence is linked only for supported workflows at the same immutable SHA; results are not duplicated.

The archive reader is bounded, never extracts files to disk and accepts only named JSON producer files. GitHub metadata and artifact reads have size/time/page limits. Collector errors become fixed unverified reason codes rather than serialized exceptions or response bodies. A forged local success JSON is not accepted as a substitute for fetching GitHub metadata and its artifact archive. The workflow does not rerun producer workflows on a failure.

## Validation and recovery

`npm run release-evidence:validate` executes offline positive and negative fixtures, including missing/failed steps, mismatched release/producer SHA, wrong environment/repository, secret field projection and malformed archives, and validates read-only/manual workflow safety. It is part of `validate:local`. Required PR CI additionally runs existing Production workflow safety tests and runtime regressions, lint and build. No real release is claimed by these fixtures. Revert this Issue's PR to remove the collector/manifest; no schema or data recovery is required.
