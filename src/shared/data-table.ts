/** #291. Provider-neutral table contracts; TanStack state is NOT persisted. */
export type Density = "compact" | "comfortable";
export type SortDirection = "asc" | "desc";
export interface ColumnDefinition {
  key: string; labelKey: string; visibleByDefault: boolean;
  sortable?: boolean; filterable?: boolean; width?: number;
  minWidth?: number; maxWidth?: number; sensitive?: boolean;
}
export interface DataTableDefinition {
  id: string; resourceType: string; schemaVersion: number;
  columns: readonly ColumnDefinition[]; supportedSorts: readonly string[];
  supportedFilters: Readonly<Record<string, readonly string[]>>;
  defaultSort: { key: string; direction: SortDirection };
  defaultPageSize: number; allowedPageSizes: readonly number[];
  defaultDensity: Density;
}
export interface TablePreference {
  tableId: string; schemaVersion: number;
  visibleColumns: readonly string[]; columnOrder: readonly string[];
  columnWidths: Readonly<Record<string, number>>;
  pageSize: number; density: Density; version: number;
}
export interface SavedView {
  id: string; tableId: string; name: string; schemaVersion: number;
  filters: Readonly<Record<string, string>>;
  sort: { key: string; direction: SortDirection };
  visibleColumns: readonly string[]; columnOrder: readonly string[];
  pageSize: number; density: Density; isDefault: boolean; version: number;
}
export const travelTableDefinition: DataTableDefinition = {
  id: "workhub.travel", resourceType: "travel_request", schemaVersion: 1,
  columns: [
    { key: "purpose", labelKey: "table.purpose", visibleByDefault: true, width: 240, minWidth: 120 },
    { key: "status", labelKey: "table.status", visibleByDefault: true, filterable: true, width: 130 },
    { key: "startDate", labelKey: "table.startDate", visibleByDefault: true, width: 125 },
    { key: "updatedAt", labelKey: "table.updatedAt", visibleByDefault: true, sortable: true, width: 160 },
    { key: "id", labelKey: "table.id", visibleByDefault: false, sortable: true, width: 160 },
  ],
  supportedSorts: ["updatedAt", "id"],
  supportedFilters: { status: ["draft", "submitting", "submitted"] },
  defaultSort: { key: "updatedAt", direction: "desc" },
  defaultPageSize: 10, allowedPageSizes: [10, 20], defaultDensity: "comfortable",
};
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: unknown, allow: ReadonlySet<string>, max: number): string[] => {
  if (!Array.isArray(v) || v.length > max || !v.every(x => typeof x === "string")) {
    throw new TypeError("Invalid columns");
  }
  const result = v as string[];
  if (result.some(x => !allow.has(x)) || new Set(result).size !== result.length) {
    throw new TypeError("Unauthorized, obsolete or duplicate column");
  }
  return [...result];
};
export const defaultTablePreference = (d: DataTableDefinition): TablePreference => ({
  tableId: d.id, schemaVersion: d.schemaVersion,
  visibleColumns: d.columns.filter(c => !c.sensitive && c.visibleByDefault).map(c => c.key),
  columnOrder: d.columns.filter(c => !c.sensitive).map(c => c.key),
  columnWidths: {}, pageSize: d.defaultPageSize, density: d.defaultDensity, version: 0,
});
export const validateTablePreference = (
  d: DataTableDefinition, value: unknown,
): TablePreference => {
  if (!record(value) || value.tableId !== d.id || value.schemaVersion !== d.schemaVersion
    || !Number.isSafeInteger(value.version) || (value.version as number) < 0
    || !d.allowedPageSizes.includes(value.pageSize as number)
    || (value.density !== "compact" && value.density !== "comfortable")
    || !record(value.columnWidths)) throw new TypeError("Invalid table preference");
  const allowed = new Set(d.columns.filter(c => !c.sensitive).map(c => c.key));
  const order = keys(value.columnOrder, allowed, d.columns.length);
  const visible = keys(value.visibleColumns, allowed, d.columns.length);
  if (!visible.length || visible.some(k => !order.includes(k))) throw new TypeError("Invalid visibility");
  const widths: Record<string,number> = {};
  for (const [k,v] of Object.entries(value.columnWidths)) {
    const col = d.columns.find(c => c.key === k);
    if (!col || !allowed.has(k) || !Number.isSafeInteger(v)
      || (v as number) < (col.minWidth ?? 64) || (v as number) > (col.maxWidth ?? 960)) {
      throw new TypeError("Invalid width");
    }
    widths[k] = v as number;
  }
  return {
    tableId:d.id, schemaVersion:d.schemaVersion, version:value.version as number,
    columnOrder:order, visibleColumns:visible, columnWidths:widths,
    pageSize:value.pageSize as number, density:value.density as Density,
  };
};
export const validateSavedView = (d: DataTableDefinition, value: unknown): SavedView => {
  if (!record(value) || typeof value.id !== "string" || value.id.length > 80
    || value.tableId !== d.id || value.schemaVersion !== d.schemaVersion
    || typeof value.name !== "string" || value.name.trim().length < 1 || value.name.length > 80
    || !record(value.filters) || !record(value.sort)
    || typeof value.isDefault !== "boolean" || !Number.isSafeInteger(value.version)) {
    throw new TypeError("Invalid saved view");
  }
  const valid = validateTablePreference(d, {...value,columnWidths:{}});
  const filters: Record<string,string> = {};
  for (const [key,v] of Object.entries(value.filters)) {
    if (!Object.hasOwn(d.supportedFilters,key) || !d.supportedFilters[key].includes(v as string)) {
      throw new TypeError("Invalid saved filter");
    }
    filters[key]=v as string;
  }
  if (!d.supportedSorts.includes(value.sort.key as string)
    || !["asc","desc"].includes(value.sort.direction as string)) throw new TypeError("Invalid saved sort");
  return {
    id:value.id as string, tableId:d.id, name:value.name.trim(),schemaVersion:d.schemaVersion,
    filters,sort:{key:value.sort.key as string,direction:value.sort.direction as SortDirection},
    columnOrder:valid.columnOrder,visibleColumns:valid.visibleColumns,
    pageSize:valid.pageSize,density:valid.density,
    isDefault:value.isDefault as boolean,version:value.version as number,
  };
};
/** Schema changes/removed fields fail visibly: never silently reassign meanings. */
export const resolveSavedView = (d:DataTableDefinition, v:unknown) => {
  try { return {view:validateSavedView(d,v),needsMigration:false as const}; }
  catch { return {view:null,needsMigration:true as const}; }
};
export const normalizeTableUrl = (d:DataTableDefinition,p:URLSearchParams) => {
  const sort=p.get("sort")??d.defaultSort.key, direction=p.get("direction")??d.defaultSort.direction;
  const status=p.get("filter.status")??"";
  if (!d.supportedSorts.includes(sort)||!["asc","desc"].includes(direction)
    ||(status&&!d.supportedFilters.status?.includes(status))) throw new TypeError("Invalid table URL");
  return {sort,direction:direction as SortDirection,status};
};
