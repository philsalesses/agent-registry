import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { AnsError, canonicalize, sha256hex } from 'ans-core';

/**
 * JSON Schema handling for offers (docs/DESIGN.md section 7).
 *
 * Every offer schema is draft 2020-12, at most 32 KB as canonical JSON, at most
 * 10 levels deep, with local `$ref`s only, and compiles under ajv strict mode
 * (unknown keywords and formats, missing types and open tuples are errors;
 * union types are allowed and strictRequired is off because
 * `anyOf: [{required: [...]}]` is an ordinary pattern).
 *
 * Each distinct schema compiles in its own Ajv instance: `$id`s and anchors
 * from one publisher can never collide with, or resolve into, another's.
 */

export const MAX_SCHEMA_BYTES = 32 * 1024;
export const MAX_SCHEMA_DEPTH = 10;
export const MAX_PATTERN_LENGTH = 512;
export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
/** errors returned to callers are capped at this many */
export const MAX_REPORTED_ERRORS = 50;

export type JsonSchema = Record<string, unknown>;

export interface SchemaError {
  /** JSON pointer into the validated value ('' is the root) */
  path: string;
  message: string;
  keyword: string;
  params: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: SchemaError[];
}

const AJV_OPTIONS = {
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
  allErrors: true,
} as const;

function newAjv(extra: Record<string, unknown> = {}): Ajv2020 {
  const ajv = new Ajv2020({ ...AJV_OPTIONS, ...extra });
  addFormats(ajv);
  return ajv;
}

/** Shared instance used only to validate schemas against the 2020-12 meta-schema; it never stores user schemas. */
let metaAjv: Ajv2020 | null = null;
function meta(): Ajv2020 {
  if (!metaAjv) metaAjv = newAjv();
  return metaAjv;
}

export function toSchemaErrors(errors: ErrorObject[] | null | undefined, max: number = MAX_REPORTED_ERRORS): SchemaError[] {
  return (errors ?? []).slice(0, max).map((e) => ({
    path: e.instancePath,
    message: e.message ?? `failed ${e.keyword}`,
    keyword: e.keyword,
    params: (e.params ?? {}) as Record<string, unknown>,
  }));
}

function invalid(field: string, message: string, errors: SchemaError[] | { path: string; message: string }[] = []): AnsError {
  return new AnsError('validation_error', `${field}: ${message}`, {
    details: { field, errors },
    fix: {
      docs: 'https://ans-registry.org/skill.md',
      next: 'Send a draft 2020-12 JSON Schema object: explicit "type" on every subschema, local "$ref"s ("#/$defs/..."), at most 32 KB and 10 levels deep',
    },
  });
}

// ---------------------------------------------------------------------------
// Structure checks
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Container depth of a JSON value (a scalar is 0, `{}` is 1). Iterative, stops early past `limit`. */
export function jsonDepth(value: unknown, limit: number = Number.POSITIVE_INFINITY): number {
  let max = 0;
  const stack: { v: unknown; d: number }[] = [{ v: value, d: 0 }];
  while (stack.length > 0) {
    const { v, d } = stack.pop()!;
    if (typeof v !== 'object' || v === null) continue;
    const depth = d + 1;
    if (depth > max) max = depth;
    if (max > limit) return max;
    const children = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const child of children) if (typeof child === 'object' && child !== null) stack.push({ v: child, d: depth });
  }
  return max;
}

const NUL = String.fromCharCode(0);

/** True when any string or key inside the value contains U+0000 (Postgres jsonb cannot store it). */
export function containsNul(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (v.includes(NUL)) return true;
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (k.includes(NUL)) return true;
        stack.push(x);
      }
    }
  }
  return false;
}

/** A copy with U+0000 removed from every string and key (for values stored in jsonb). */
export function stripNul<T>(value: T): T {
  if (typeof value === 'string') return value.split(NUL).join('') as T;
  if (Array.isArray(value)) return value.map((x) => stripNul(x)) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k.split(NUL).join('')] = stripNul(v);
    return out as T;
  }
  return value;
}

const SINGLE_SUBSCHEMA = ['additionalProperties', 'items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema'];
const SUBSCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SUBSCHEMA_ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

/** Visit every schema object (not data values such as const, enum, default or examples). */
function eachSubschema(root: JsonSchema, visit: (schema: Record<string, unknown>, pointer: string) => void): void {
  const stack: { s: unknown; p: string }[] = [{ s: root, p: '#' }];
  while (stack.length > 0) {
    const { s, p } = stack.pop()!;
    if (!isPlainObject(s)) continue;
    visit(s, p);
    for (const k of SINGLE_SUBSCHEMA) if (k in s) stack.push({ s: s[k], p: `${p}/${k}` });
    for (const k of SUBSCHEMA_MAPS) {
      const m = s[k];
      if (isPlainObject(m)) for (const [name, sub] of Object.entries(m)) stack.push({ s: sub, p: `${p}/${k}/${name}` });
    }
    for (const k of SUBSCHEMA_ARRAYS) {
      const a = s[k];
      if (Array.isArray(a)) a.forEach((sub, i) => stack.push({ s: sub, p: `${p}/${k}/${i}` }));
    }
  }
}

const LOCAL_REF = /^#(\/.*)?$/;
/** A quantified group that itself contains a quantifier, e.g. (a+)+ or ([a-z]+-)*: catastrophic backtracking. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+(?:,\d*)?\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;

function checkPattern(pointer: string, pattern: string): { path: string; message: string } | null {
  if (pattern.length > MAX_PATTERN_LENGTH) return { path: pointer, message: `pattern is longer than ${MAX_PATTERN_LENGTH} characters` };
  if (NESTED_QUANTIFIER.test(pattern)) {
    return { path: pointer, message: `pattern ${JSON.stringify(pattern)} repeats a group that already contains a quantifier; rewrite it without nested quantifiers (they can hang the validator)` };
  }
  return null;
}

/**
 * Throws 400 validation_error unless `schema` is an acceptable offer schema.
 * `field` names the request field in the error ('inputSchema', 'outputSchema', 'schema').
 */
export function validateSchemaDocument(schema: unknown, field: string = 'schema'): void {
  if (!isPlainObject(schema)) throw invalid(field, 'must be a JSON Schema object');

  const depth = jsonDepth(schema, MAX_SCHEMA_DEPTH);
  if (depth > MAX_SCHEMA_DEPTH) throw invalid(field, `is nested more than ${MAX_SCHEMA_DEPTH} levels deep`);
  if (containsNul(schema)) throw invalid(field, 'must not contain the U+0000 character');

  let canonical: string;
  try {
    canonical = canonicalize(schema);
  } catch (err) {
    throw invalid(field, err instanceof Error ? err.message : 'is not canonical JSON');
  }
  const bytes = Buffer.byteLength(canonical, 'utf8');
  if (bytes > MAX_SCHEMA_BYTES) throw invalid(field, `is ${bytes} bytes as canonical JSON; the limit is ${MAX_SCHEMA_BYTES}`);

  const $schema = schema.$schema;
  if ($schema !== undefined && (typeof $schema !== 'string' || $schema.replace(/#$/, '') !== DRAFT_2020_12)) {
    throw invalid(field, `$schema must be "${DRAFT_2020_12}" (draft 2020-12) or omitted`);
  }

  const problems: { path: string; message: string }[] = [];
  eachSubschema(schema, (s, pointer) => {
    for (const key of ['$ref', '$dynamicRef']) {
      const ref = s[key];
      if (typeof ref === 'string' && !LOCAL_REF.test(ref)) {
        problems.push({ path: `${pointer}/${key}`, message: `${key} ${JSON.stringify(ref)} is not local; only "#" and "#/..." references are allowed` });
      }
    }
    const id = s.$id;
    if (typeof id === 'string' && (id.includes(':') || id.startsWith('//'))) {
      problems.push({ path: `${pointer}/$id`, message: `$id ${JSON.stringify(id)} points outside this document; remove it or use a relative id` });
    }
    if (pointer !== '#' && s.$schema !== undefined) {
      problems.push({ path: `${pointer}/$schema`, message: '$schema is only allowed at the root' });
    }
    if (typeof s.pattern === 'string') {
      const p = checkPattern(`${pointer}/pattern`, s.pattern);
      if (p) problems.push(p);
    }
    if (isPlainObject(s.patternProperties)) {
      for (const key of Object.keys(s.patternProperties)) {
        const p = checkPattern(`${pointer}/patternProperties`, key);
        if (p) problems.push(p);
      }
    }
  });
  if (problems.length > 0) throw invalid(field, problems[0].message, problems.slice(0, MAX_REPORTED_ERRORS));

  const m = meta();
  let metaOk: boolean;
  try {
    metaOk = m.validateSchema(schema) as boolean;
  } catch (err) {
    throw invalid(field, err instanceof Error ? err.message : 'failed meta-schema validation');
  }
  if (!metaOk) {
    const errors = toSchemaErrors(m.errors);
    throw invalid(field, `is not a valid draft 2020-12 schema (${errors[0]?.path || '/'} ${errors[0]?.message ?? ''})`.trim(), errors);
  }

  let fn: ValidateFunction;
  try {
    fn = compileFresh(schema);
  } catch (err) {
    throw invalid(field, err instanceof Error ? err.message : 'does not compile');
  }
  remember(sha256hex(canonical), fn);
}

// ---------------------------------------------------------------------------
// Compile and validate
// ---------------------------------------------------------------------------

/** sha256hex(canonicalize(schema)) */
export function schemaHash(schema: unknown): string {
  return sha256hex(canonicalize(schema));
}

function compileFresh(schema: JsonSchema): ValidateFunction {
  // meta-validation already ran (or the schema was accepted at publish); strict checks run during compile
  return newAjv({ validateSchema: false, addUsedSchema: false }).compile(schema);
}

const CACHE_LIMIT = 500;
const cache = new Map<string, ValidateFunction>();

function remember(key: string, fn: ValidateFunction): void {
  cache.delete(key);
  cache.set(key, fn);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/** Compile a schema that already passed validateSchemaDocument. Cached by schema hash (bounded, oldest evicted). */
export function compile(schema: JsonSchema): ValidateFunction {
  const key = schemaHash(schema);
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return hit;
  }
  const fn = compileFresh(schema);
  remember(key, fn);
  return fn;
}

/** Validate a value. A schema that does not compile reports one error instead of throwing. */
export function validateAgainst(schema: JsonSchema, value: unknown): ValidationResult {
  let fn: ValidateFunction;
  try {
    fn = compile(schema);
  } catch (err) {
    return { ok: false, errors: [{ path: '', message: `schema does not compile: ${err instanceof Error ? err.message : String(err)}`, keyword: 'schema', params: {} }] };
  }
  const ok = fn(value) as boolean;
  return { ok, errors: ok ? [] : toSchemaErrors(fn.errors) };
}

/** Top-level property names of an object schema, required ones first. */
export function topFields(schema: unknown): string[] {
  if (!isPlainObject(schema)) return [];
  const props = isPlainObject(schema.properties) ? Object.keys(schema.properties) : [];
  const required = Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === 'string') : [];
  const out: string[] = [];
  for (const name of [...required, ...props]) if (!out.includes(name)) out.push(name);
  return out;
}
