import { Type, type TUnsafe } from "typebox";

/** A string enum as a plain `{type:"string",enum}` schema (MCP clients and every model API read it; anyOf/const trips some). */
export function StringEnum<T extends readonly string[]>(values: T, options?: { description?: string; default?: T[number] }): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values,
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.default ? { default: options.default } : {}),
  });
}
