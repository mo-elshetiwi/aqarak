import type { OwnerQuery } from "./contract";
export function cursorHistory(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((cursor) => cursor.length <= 1000)
    .slice(-100);
}
export function pageLink(
  base: string,
  query: OwnerQuery,
  cursor: string | null,
  previous: string[],
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "cursor" && value !== undefined) params.set(key, String(value));
  }
  if (cursor) params.set("cursor", cursor);
  for (const value of previous) params.append("previous", value);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}
