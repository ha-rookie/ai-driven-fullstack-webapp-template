# Japanese PDF font verification

Issue: #403  
Parent: #306

## Purpose

Verify that the provider-neutral `PdfFontProvider` boundary can supply Japanese-capable font bytes to `PdfLibReportRenderer` and produce a PDF without relying on a system-installed font or a remote font fetch from the renderer.

## CI fixture

Tests use `@fontsource/noto-sans-jp@5.2.5` as a development-only fixture.

- font: Noto Sans JP
- package license: OFL-1.1
- package is exact-pinned in `package.json` / `package-lock.json`
- test reads the packaged Japanese regular WOFF asset and passes its bytes through `PdfFontProvider`
- the renderer itself remains unaware of Fontsource, filesystem paths, or Noto-specific behavior

The upstream Noto project distributes Noto fonts under the SIL Open Font License. The package metadata also identifies Noto Sans JP as OFL-1.1.

## Production boundary

This fixture does not select the production corporate font and does not add a Production font resource.

A project may provide licensed font bytes from an approved application asset, private object storage, Worker binding, or another bounded provider. The renderer must not fetch arbitrary remote font URLs.

## Verification level

The automated test proves:

- Japanese strings pass through the real pdf-lib + fontkit custom-font path
- custom font bytes are embedded/subset by the existing adapter
- output is a structurally valid PDF beginning with `%PDF-`
- no system font is required by the test

It does not prove:

- pixel-perfect typography
- a specific corporate font
- all Japanese/CJK glyph coverage
- Production asset deployment or binding
