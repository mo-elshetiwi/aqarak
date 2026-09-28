import { z } from "zod";

export interface StrictJsonSchema {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid JSON Schema");
  const object = Object.fromEntries(
    Object.entries(parsed.data)
      .filter(([key]) => key !== "$schema")
      .map(([key, child]) => [key, normalize(child)]),
  );
  if (Array.isArray(object.type)) {
    const types = z.array(z.string()).safeParse(object.type);
    if (!types.success) throw new TypeError("Invalid schema types");
    const rest = Object.fromEntries(
      Object.entries(object).filter(([key]) => key !== "type"),
    );
    return { ...rest, anyOf: types.data.map((type) => ({ type })) };
  }
  if (object.type === "object") {
    const properties = z
      .record(z.string(), z.unknown())
      .safeParse(object.properties);
    if (!properties.success || object.additionalProperties !== false)
      throw new TypeError("Structured output objects must be strict");
    const required = z.array(z.string()).safeParse(object.required ?? []);
    if (
      !required.success ||
      Object.keys(properties.data).some((key) => !required.data.includes(key))
    )
      throw new TypeError("Structured output properties must be required");
  }
  return object;
}
/** Convert a Zod output schema and reject objects incompatible with strict structured output. */
export function toStrictJsonSchema(
  schema: z.ZodType,
  name: string,
): StrictJsonSchema {
  const normalized = z
    .record(z.string(), z.unknown())
    .safeParse(normalize(z.toJSONSchema(schema, { io: "output" })));
  if (!normalized.success) throw new TypeError("Invalid root schema");
  return { name, schema: normalized.data };
}
