export type ExampleResourceStatus = "draft" | "active" | "finalized";

export interface ExampleResource {
  id: string;
  name: string;
  status: ExampleResourceStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const allowedTransitions: Record<ExampleResourceStatus, readonly ExampleResourceStatus[]> = {
  draft: ["active"],
  active: ["finalized"],
  finalized: [],
};

export const canTransitionExampleResource = (
  from: ExampleResourceStatus,
  to: ExampleResourceStatus,
): boolean => allowedTransitions[from].includes(to);

export const isTerminalExampleResourceStatus = (
  status: ExampleResourceStatus,
): boolean => status === "finalized";
