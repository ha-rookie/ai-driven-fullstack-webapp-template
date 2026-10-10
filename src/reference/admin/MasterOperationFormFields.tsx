/**
 * Common form elements for an explicitly approved Master operation.
 * These components do not grant permission or execute anything. The existing
 * server-side authorization, preview, CSRF, version and audit remain authoritative.
 */
interface MasterOperationConfirmationFieldsProps {
  readonly reason: string;
  readonly onReasonChange: (value: string) => void;
  readonly reasonLabel: string;
  readonly reasonPlaceholder?: string;
  readonly confirmed: boolean;
  readonly onConfirmChange: (value: boolean) => void;
  readonly confirmationLabel: string;
  readonly busy: boolean;
  readonly submitLabel: string;
}

export function MasterOperationConfirmationFields({
  reason, onReasonChange, reasonLabel, reasonPlaceholder,
  confirmed, onConfirmChange, confirmationLabel, busy, submitLabel,
}: MasterOperationConfirmationFieldsProps) {
  return <>
    <label>{reasonLabel}
      <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)}
        placeholder={reasonPlaceholder} maxLength={200} required />
    </label>
    <label className="admin-confirm">
      <input type="checkbox" checked={confirmed}
        onChange={(event) => onConfirmChange(event.target.checked)} />
      {confirmationLabel}
    </label>
    <div className="admin-retry-actions">
      <button type="submit" disabled={busy || !confirmed || !reason.trim()}>{submitLabel}</button>
    </div>
  </>;
}

interface MasterFutureDateFieldProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}

export function MasterFutureDateField({ label, value, placeholder, onChange }: MasterFutureDateFieldProps) {
  return <label>{label}
    <input value={value} onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder} required />
  </label>;
}
