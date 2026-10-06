# Report locale, timezone, currency, and retention semantics

## Locale and timezone

A Report View Model carries an explicit BCP 47 locale and IANA time zone. Invalid values are rejected. Builders must not infer either value from the Worker, browser, operating system, or deployment region.

Historical output should format dates using the locale/timezone fixed in the Report View Model or in report-specific snapshot data.

## Currency

Currency is business data, not a renderer default. A report that contains money should include an explicit ISO 4217 currency code in its validated report-specific data schema. The Report Core does not assume JPY, USD, or any other currency and does not infer currency from locale.

## Retention and expiry

GeneratedArtifact may carry `expiresAt`. When present, report download fails closed once the current time is greater than or equal to the expiry time. Expiry does not grant access before that time; current authorization is still required.

Expiry is an access/lifecycle boundary, not physical deletion. Actual retention periods, purge schedules, legal holds, backup behavior, and deletion evidence remain Project policy under #46 Data Lifecycle. Report Foundation does not implement an independent purge system.

Production purge, retention-policy changes, restore, and destructive operations remain Human Gate operations.
