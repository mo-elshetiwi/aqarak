/** Decodes the Data API's JSONB text representation before strict schema validation. */
export function decodeJsonColumn(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}
