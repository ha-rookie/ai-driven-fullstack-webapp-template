interface ExampleResourceScopeRow {
  scopeId: string;
}

export const findExampleResourceScopeId = async (
  db: D1Database,
  resourceId: string,
): Promise<string | null> => {
  const row = await db
    .prepare(
      "SELECT scope_id AS scopeId FROM example_resource_scope_bindings WHERE resource_id=?",
    )
    .bind(resourceId)
    .first<ExampleResourceScopeRow>();

  return row?.scopeId ?? null;
};
