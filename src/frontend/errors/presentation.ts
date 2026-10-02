import { createElement, type ReactElement } from "react";
import type { ErrorViewModel } from "./model";

export type ErrorPresentationVariant = "inline" | "page" | "toast";

export interface ErrorPresentationProps {
  readonly error: ErrorViewModel;
  readonly variant?: ErrorPresentationVariant;
  readonly onRetry?: () => void;
  readonly onRefresh?: () => void;
  readonly onReauthenticate?: () => void;
}

const actionFor = (props: ErrorPresentationProps): ReactElement | null => {
  const { error } = props;
  if (error.recovery === "retry" && props.onRetry) {
    return createElement("button", { type: "button", onClick: props.onRetry }, "Try again");
  }
  if (error.recovery === "refresh" && props.onRefresh) {
    return createElement("button", { type: "button", onClick: props.onRefresh }, "Refresh");
  }
  if (error.recovery === "reauthenticate" && props.onReauthenticate) {
    return createElement("button", { type: "button", onClick: props.onReauthenticate }, "Sign in");
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
    ? createElement("p", { "data-request-id": true }, `Request ID: ${error.requestId}`)
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
