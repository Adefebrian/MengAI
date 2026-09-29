// Minimal JSON Schema validator for the subset the tool specs use: object
// (properties, required), string (enum, minLength, maxLength), integer and
// number (minimum, maximum), boolean, array (items, minItems, maxItems).
// Unknown properties are dropped, so a chatty model cannot smuggle extra
// arguments into a handler. Returns the cleaned value or the first error.
export type JsonSchema = {
  type?: "object" | "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

export type Validated = { ok: true; value: unknown } | { ok: false; error: string };

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export function validateArgs(schema: JsonSchema, value: unknown, path = "arguments"): Validated {
  switch (schema.type) {
    case "object": {
      if (typeOf(value) !== "object") return { ok: false, error: `${path} must be an object` };
      const input = value as Record<string, unknown>;
      // an object schema without properties accepts any object (free-form args)
      if (!schema.properties) return { ok: true, value: input };
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        if (input[key] === undefined || input[key] === null) return { ok: false, error: `${path}.${key} is required` };
      }
      for (const [key, sub] of Object.entries(schema.properties)) {
        const v = input[key];
        if (v === undefined || v === null) continue;
        const r = validateArgs(sub, v, `${path}.${key}`);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out };
    }
    case "array": {
      if (!Array.isArray(value)) return { ok: false, error: `${path} must be an array` };
      if (schema.minItems !== undefined && value.length < schema.minItems) return { ok: false, error: `${path} needs at least ${schema.minItems} items` };
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return { ok: false, error: `${path} allows at most ${schema.maxItems} items` };
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = schema.items ? validateArgs(schema.items, value[i], `${path}[${i}]`) : { ok: true as const, value: value[i] };
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "string": {
      if (typeof value !== "string") return { ok: false, error: `${path} must be a string` };
      if (schema.enum && !schema.enum.includes(value)) return { ok: false, error: `${path} must be one of ${schema.enum.join(", ")}` };
      if (schema.minLength !== undefined && value.length < schema.minLength) return { ok: false, error: `${path} is too short` };
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return { ok: false, error: `${path} is longer than ${schema.maxLength} characters` };
      return { ok: true, value };
    }
    case "integer":
    case "number": {
      const n = typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: `${path} must be a number` };
      if (schema.type === "integer" && !Number.isInteger(n)) return { ok: false, error: `${path} must be an integer` };
      if (schema.minimum !== undefined && n < schema.minimum) return { ok: false, error: `${path} must be at least ${schema.minimum}` };
      if (schema.maximum !== undefined && n > schema.maximum) return { ok: false, error: `${path} must be at most ${schema.maximum}` };
      return { ok: true, value: n };
    }
    case "boolean": {
      if (value === "true" || value === "false") return { ok: true, value: value === "true" };
      if (typeof value !== "boolean") return { ok: false, error: `${path} must be true or false` };
      return { ok: true, value };
    }
    default:
      return { ok: true, value };
  }
}
