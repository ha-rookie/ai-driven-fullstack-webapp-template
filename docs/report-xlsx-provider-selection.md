# XLSX provider selection

Stage 9 keeps spreadsheet semantics separate from the concrete XLSX library.

## Current decision

The Core contract is provider-neutral. A concrete provider is intentionally not selected in Stage 9a.

### ExcelJS 4.4.0
- MIT
- mature workbook writer API
- normal npm distribution
- current upstream dependency tree has unresolved maintenance/security concerns reported in 2026
- must not be added until repository vulnerability and supply-chain gates are demonstrated green

### SheetJS Community Edition
- Apache-2.0
- broad XLSX support
- current upstream installation guidance uses the SheetJS CDN tarball rather than the stale npm registry package and recommends vendoring for stability
- adopting it requires an explicit vendoring / provenance / update-policy decision

## Required adapter boundary

A future concrete adapter consumes only `XlsxWorkbookTemplate` / `XlsxWorkbookModel` and returns the existing `RenderedReport` contract. Provider-specific workbook/cell types must not leak into Report Core.

## Security defaults

- user/domain strings are literal data, never implicit formulas
- formula-like prefixes are escaped by `xlsxLiteralText`
- no macros/VBA
- no hyperlinks or external relationships in the baseline contract
- no remote workbook template
- bounded sheet/row/column/cell sizes
- Japanese Unicode is part of the contract tests

A provider may be adopted only after exact pinning and the repository lockfile, SBOM, license, vulnerability and Worker-runtime checks pass.
