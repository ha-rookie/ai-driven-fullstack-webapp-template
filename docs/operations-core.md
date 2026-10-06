# Operations Core & Risk Policy

Operations Core is the provider- and business-neutral control-plane model shared by future Job, Data Correction, Integration and Recovery operations.

## Flow

```text
Observe → Detect → Assess → Preview → Authorize → Policy → Act → Verify → Audit
```

Authorization and operation risk are separate decisions:

- Authorization answers whether the actor has the capability for the scoped resource.
- Risk Policy answers whether an otherwise-authorized operation may execute under the current environment, blast radius and actor type.
- Risk Policy never upgrades an authorization denial to allow.

## Model

- `ResourceRef`
- `Finding` and separate `ActionRequired`
- `OperationDefinition`
- `OperationRequest`
- `OperationPreview`
- `OperationExecution`
- `OperationVerification`
- explicit UNKNOWN / PARTIAL / CONFLICT states

## Risk baseline

- OBSERVE
- OPERATIONAL
- CONTROLLED_CHANGE
- PRIVILEGED
- HUMAN_GATE

Production controlled changes are Human Gate. AI Agent controlled changes are also Human Gate. Large operational blast radius escalates to PRIVILEGED. External side effects escalate operational actions to CONTROLLED_CHANGE.

This is a conservative Template baseline. Projects may make policy stricter; weakening Human Gate for Production infrastructure/destructive operations is outside normal Template execution and remains a Human Gate decision.

## Safeguards

Preview, confirmation, reason, step-up, approval, audit and verification are explicit policy outputs. UI visibility is never the authorization or policy source of truth.

## Non-goals

- Admin Portal UI
- arbitrary SQL or row editor
- generic workflow/BPM engine
- provider-specific console
- Production infrastructure execution
