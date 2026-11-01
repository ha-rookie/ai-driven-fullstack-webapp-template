import type { Localization } from "../../shared/localization";
import type { ErrorCopyResolver, ErrorPresentationKind } from "./model";

/** #63 keeps server error codes. Only explicitly approved public codes select presentation keys. */
const SAFE_CODE_KEY: Readonly<Record<string, string>> = Object.freeze({
  validation_failed: "error.code.validation_failed",
  authentication_required: "error.code.authentication_required",
  forbidden: "error.code.forbidden",
  not_found: "error.code.not_found",
  conflict: "error.code.conflict",
  rate_limited: "error.code.rate_limited",
});

/** Pure presentation adapter: no raw provider message, stack, HTML or auth decision. */
export const createLocalizedErrorCopyResolver = (localization: Localization): ErrorCopyResolver =>
  (kind: ErrorPresentationKind, context) => ({
    title: localization.t("error." + kind + ".title"),
    message: localization.t(
      context.code && Object.prototype.hasOwnProperty.call(SAFE_CODE_KEY, context.code)
        ? SAFE_CODE_KEY[context.code]!
        : "error." + kind + ".message",
    ),
    ...(kind === "validation" ? { fieldMessage: localization.t("error.validation.field") } : {}),
  });
