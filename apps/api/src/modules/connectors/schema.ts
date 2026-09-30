// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Foreign JSON Schemas (MCP inputSchema, OpenAPI parameters and bodies) cut
// down to the subset the tool validator and the prompt need: type,
// properties, required, items, enum and bounds, short descriptions. Every
// schema costs tokens on every step it is loaded, so it stays small: at most
// 40 properties per object, 4 levels deep, 120 character descriptions.
// Local "#/..." $refs resolve against the document; anything else is dropped.
export type Schema = Record<string, unknown>;

const TYPES = new Set(["object", "string", "integer", "number", "boolean", "array"]);
const MAX_PROPS = 40;
const MAX_DEPTH = 4;
const DESC_CHARS = 120;
const MAX_ENUM = 50;

const clipText = (s: unknown, n = DESC_CHARS): string | undefined => {
  if (typeof s !== "string") return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

/** Resolves a local JSON pointer ("#/components/schemas/Order"); null when it is not local or not found. */
export function resolveRef(doc: unknown, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let at: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!at || typeof at !== "object") return null;
    at = (at as Record<string, unknown>)[key];
  }
  return at ?? null;
}

function deref(doc: unknown, node: unknown, seen: Set<string>): Schema | null {
  let n = node;
  for (let i = 0; i < 8 && n && typeof n === "object" && typeof (n as Schema).$ref === "string"; i++) {
    const ref = (n as Schema).$ref as string;
    if (seen.has(ref)) return null;
    seen.add(ref);
    n = resolveRef(doc, ref);
  }
  return n && typeof n === "object" && !Array.isArray(n) ? (n as Schema) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A foreign schema as the validator subset. Unknown shapes become an untyped (accept anything) schema. */
export function normalizeSchema(node: unknown, doc: unknown = node, depth = 0, seen: Set<string> = new Set()): Schema {
  const s = deref(doc, node, new Set(seen));
  if (!s) return {};
  let type = s.type;
  if (Array.isArray(type)) type = type.find((t) => t !== "null");
  if (typeof type !== "string" || !TYPES.has(type)) {
    // allOf with one object part is common in OpenAPI: take the first usable branch
    const branch = [s.allOf, s.oneOf, s.anyOf].find((b) => Array.isArray(b) && b.length > 0) as unknown[] | undefined;
    if (branch && depth < MAX_DEPTH) return normalizeSchema(branch[0], doc, depth + 1, seen);
    if (s.properties && typeof s.properties === "object") type = "object";
    else return clipText(s.description) ? { description: clipText(s.description) } : {};
  }
  const out: Schema = { type };
  const description = clipText(s.description);
  if (description) out.description = description;
  if (type === "string") {
    if (Array.isArray(s.enum)) out.enum = s.enum.filter((v) => typeof v === "string").slice(0, MAX_ENUM);
    if (num(s.minLength) !== undefined) out.minLength = s.minLength;
    if (num(s.maxLength) !== undefined) out.maxLength = s.maxLength;
  } else if (type === "number" || type === "integer") {
    if (num(s.minimum) !== undefined) out.minimum = s.minimum;
    if (num(s.maximum) !== undefined) out.maximum = s.maximum;
    if (Array.isArray(s.enum)) out.enum = s.enum.filter((v) => typeof v === "number").slice(0, MAX_ENUM);
  } else if (type === "array") {
    if (depth < MAX_DEPTH && s.items) out.items = normalizeSchema(s.items, doc, depth + 1, seen);
    if (num(s.minItems) !== undefined) out.minItems = s.minItems;
    if (num(s.maxItems) !== undefined) out.maxItems = s.maxItems;
  } else if (type === "object") {
    const props = s.properties && typeof s.properties === "object" ? Object.entries(s.properties as Record<string, unknown>) : [];
    if (props.length && depth < MAX_DEPTH) {
      const properties: Record<string, Schema> = {};
      for (const [k, v] of props.slice(0, MAX_PROPS)) properties[k] = normalizeSchema(v, doc, depth + 1, seen);
      out.properties = properties;
      const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string" && r in properties) : [];
      if (required.length) out.required = required;
    }
  }
  return out;
}

/** An object schema for tool arguments: always type object with properties (empty when none). */
export function argsSchema(node: unknown, doc?: unknown): Schema {
  const s = normalizeSchema(node, doc ?? node);
  if (s.type !== "object") return { type: "object", properties: {} };
  return s.properties ? s : { ...s, properties: {} };
}
