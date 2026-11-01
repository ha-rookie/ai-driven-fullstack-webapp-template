import { createElement, type ReactElement } from "react";
import type { ErrorViewModel } from "./model";
import type { Localization } from "../../shared/localization";

export type ErrorPresentationVariant = "inline" | "page" | "toast";

export interface ErrorPresentationProps {
  readonly error: ErrorViewModel;
  readonly localization?: Localization;
  readonly variant?: ErrorPresentationVariant;
  readonly onRetry?: () => void;
  readonly onRefresh?: () => void;
  readonly onReauthenticate?: () => void;
}

const actionFor = (props: ErrorPresentationProps): ReactElement | null => {
  const { error, localization } = props;
  if (error.recovery === "retry" && props.onRetry) {
    return createElement("button", { type: "button", onClick: props.onRetry }, localization?.t("error.action.retry") ?? "Try again");
  }
  if (error.recovery === "refresh" && props.onRefresh) {
    return createElement("button", { type: "button", onClick: props.onRefresh }, localization?.t("error.action.refresh") ?? "Refresh");
  }
  if (error.recovery === "reauthenticate" && props.onReauthenticate) {
    return createElement("button", { type: "button", onClick: props.onReauthenticate }, localization?.t("error.action.reauthenticate") ?? "Sign in");
  }
  return null;
};

export const ErrorPresentation = (props: ErrorPresentationProps): ReactElement => {
  const { error, variant = "inline" } = props;
  const fieldList = error.fields.length > 0
    ? createElement(
        "ul",
        { "data-error-fields": true },
        ...error.fields.map((field) =>
          createElement("li", { key: `${field.path}:${field.code}`, "data-field-path": field.path }, field.message),
        ),
      )
    : null;

  const requestId = error.requestId
    ? createElement("p", { "data-request-id": true }, props.localization?.t("error.request_id", { id: error.requestId }) ?? `Request ID: ${error.requestId}`)
    : null;

  return createElement(
    "section",
    {
      role: "alert",
      "aria-live": variant === "toast" ? "assertive" : "polite",
      "data-error-kind": error.kind,
      "data-error-variant": variant,
    },
    createElement("h2", null, error.title),
    createElement("p", null, error.message),
    fieldList,
    requestId,
    actionFor(props),
  );
};
