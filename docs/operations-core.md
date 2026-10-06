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


## Execution guard

An Operation Preview is not an execution capability. Every execution path must pass the server-side execution guard.

The guard rejects:

- DENY
- HUMAN_GATE direct execution
- stale policy version
- missing confirmation
- missing reason
- missing step-up evidence
- missing approval evidence where an executable policy explicitly requires it

HUMAN_GATE is intentionally non-executable even when an approval identifier is supplied. A future approval workflow must produce a separately authorized executable state; callers cannot turn a Human Gate into an allow decision by attaching metadata.

Human, Service and AI Agent callers use the same guard. Transport or UI type never grants an execution bypass.

### Audit boundary

Operation audit uses an explicit metadata projection: request identity, actor, operation name, resource reference, affected count and outcome/rejection reason. Raw command payload, secret values and sensitive business bodies are not accepted by the operation audit projection.

Correlation remains on the Operation Preview/Execution contract while the existing requestId remains the current Audit correlation field. A future durable operation record may link both without copying business payload.
