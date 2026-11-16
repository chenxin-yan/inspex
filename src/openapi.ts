// OpenAPI 3.0 / 3.1 document -> declarations for `paths`, `components` and `operations`.
//
// The output equals what openapi-typescript 7 emits with its default options (so tools built on them, such
// as openapi-fetch, work unchanged), except where upstream's output is wrong or does not compile: there it
// is the correct type, or `unknown` and a problem. Each difference is named in tests/differential.test.ts
// and in the README. Upstream quirks that do not make types wrong (the `path` strings below, discriminator
// patching) are mirrored on purpose.

export interface Problem {
	/** JSON pointer segments of the offending value. */
	pointer: string[];
	message: string;
	code: ProblemCode;
}

/** Diagnostic codes, shown as `inspex<code>`. */
export const ProblemCode = {
	InvalidSyntax: 1,
	UnsupportedDocument: 2,
	DuplicateOperationId: 3,
	UnresolvableRef: 4,
	UnsupportedRef: 5,
	InvalidValue: 6,
	DuplicateRegisteredName: 7,
	InternalError: 8,
	InvalidOption: 9,
	RefCycle: 10,
} as const;
export type ProblemCode = (typeof ProblemCode)[keyof typeof ProblemCode];

export interface GenerateOptions {
	/** Mirrors openapi-typescript's `readWriteMarkers`. */
	readWriteMarkers?: boolean;
}

export interface GenerateResult {
	/** Declarations; undefined when the document cannot be typed at all. */
	text: string | undefined;
	problems: Problem[];
}

// The exact text openapi-typescript emits for `readWriteMarkers: true`, so both outputs are the same types.
const readWriteHelpers = `export type $Read<T> = { readonly $read: T };
export type $Write<T> = { readonly $write: T };
export type Readable<T> = T extends $Write<any> ? never : T extends $Read<infer U> ? Readable<U> : T extends (infer E)[] ? Readable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Write<any> ? never : K]: Readable<T[K]> } : T;
export type Writable<T> = T extends $Read<any> ? never : T extends $Write<infer U> ? Writable<U> : T extends (infer E)[] ? Writable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? never : K]: Writable<T[K]> } & { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? K : never]?: never } : T;
`;

const withRequiredHelper = "type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };\n";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const parameterLocations = ["query", "header", "path", "cookie"] as const;
const componentKinds = [
	"schemas",
	"responses",
	"parameters",
	"requestBodies",
	"headers",
	"pathItems",
] as const;
type ComponentKind = (typeof componentKinds)[number];

/** A type expression. `kind` decides parentheses and mirrors upstream's checks on AST node kinds. */
interface Type {
	text: string;
	kind: "atom" | "array" | "tuple" | "union" | "intersection" | "negative";
}

const atom = (text: string): Type => ({ text, kind: "atom" });
const UNKNOWN = atom("unknown");
const NEVER = atom("never");
const NULL = atom("null");
const STRING = atom("string");
const NUMBER = atom("number");
const BOOLEAN = atom("boolean");
const primitiveTexts = new Set(["boolean", "never", "null", "number", "string", "undefined"]);

function union(types: Type[]): Type {
	const unique = dedupe(types);
	if (unique.length === 0) return NEVER;
	if (unique.length === 1) return unique[0] as Type;
	return { text: unique.map((t) => t.text).join(" | "), kind: "union" };
}

function intersection(types: Type[]): Type {
	const unique = dedupe(types);
	if (unique.length === 0) return NEVER;
	if (unique.length === 1) return unique[0] as Type;
	return {
		text: unique.map((t) => (t.kind === "union" ? `(${t.text})` : t.text)).join(" & "),
		kind: "intersection",
	};
}

function dedupe(types: Type[]): Type[] {
	const seen = new Set<string>();
	return types.filter((t) => !seen.has(t.text) && seen.add(t.text));
}

function arrayOf(type: Type): Type {
	const element = type.kind === "atom" || type.kind === "array" || type.kind === "tuple";
	return { text: element ? `${type.text}[]` : `(${type.text})[]`, kind: "array" };
}

function objectType(members: string[]): Type {
	return atom(`{\n${members.join("\n")}\n}`);
}

const identifier = /^[A-Za-z_$][\w$]*$/;
function propertyKey(name: string): string {
	// Numeric keys stay numeric, as upstream prints them: `keyof { 200: X }` is `200`, not `"200"`, and
	// openapi-fetch finds success responses by numeric status.
	const numeric = String(Number(name)) === name && !name.startsWith("-");
	return numeric || identifier.test(name) ? name : JSON.stringify(name);
}

function literal(value: unknown): Type {
	if (typeof value === "string") return atom(JSON.stringify(value));
	if (typeof value === "number")
		return { text: String(value), kind: value < 0 ? "negative" : "atom" };
	if (typeof value === "boolean") return atom(String(value));
	if (value === null) return NULL;
	if (Array.isArray(value)) {
		return value.length
			? { text: `[${value.map((v) => literal(v).text).join(", ")}]`, kind: "tuple" }
			: arrayOf(NEVER);
	}
	if (typeof value === "object") {
		const entries = Object.entries(value);
		return entries.length
			? objectType(entries.map(([k, v]) => `${propertyKey(k)}: ${literal(v).text};`))
			: atom("Record<string, never>");
	}
	return UNKNOWN;
}

function jsDoc(value: unknown): string {
	if (!isObject(value)) return "";
	const lines: string[] = [];
	for (const field of ["title", "summary"]) {
		if (typeof value[field] === "string" && value[field]) lines.push(value[field].trim());
	}
	if (typeof value.format === "string") lines.push(`Format: ${value.format}`);
	if (value.deprecated === true) lines.push("@deprecated");
	if (typeof value.description === "string" && value.description) {
		lines.push(`@description ${value.description.trim()}`);
	}
	if (value.default !== undefined) lines.push(`@default ${JSON.stringify(value.default)}`);
	if (!lines.length) return "";
	const text = lines.join("\n").replaceAll("*/", "*\\/").replaceAll(/\r?\n/g, "\n * ");
	return `/**\n * ${text}\n */\n`;
}

type Json = Record<string, unknown>;
function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON pointer of a value, built only when a problem needs it. */
type Location = { readonly up: Location; readonly key: string } | undefined;
function at(location: Location, ...keys: (string | number)[]): Location {
	let result = location;
	for (const key of keys) result = { up: result, key: String(key) };
	return result;
}
function segments(location: Location): string[] {
	const out: string[] = [];
	for (let l = location; l; l = l.up) out.push(l.key);
	return out.toReversed();
}

export function formatPointer(pointer: readonly string[]): string {
	return `#${pointer.map((s) => `/${escapePointer(s)}`).join("")}`;
}
function escapePointer(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
/** The segments of a local `$ref` ("#/..."), or undefined for anything else. */
function parsePointer(ref: unknown): string[] | undefined {
	if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
	let pointer: string;
	try {
		// A URI fragment is percent-decoded before its JSON Pointer escapes are read (RFC 6901 §6).
		pointer = decodeURIComponent(ref.slice(2));
	} catch {
		return undefined;
	}
	return pointer.split("/").map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

const nodeKey = (kind: string, name: string): string => `${kind}\0${name}`;

/** `#/components/<kind>/<name>` as kind and name, or undefined. */
function componentOf(
	pointer: readonly string[] | undefined,
): { kind: ComponentKind; name: string } | undefined {
	if (pointer?.length !== 3 || pointer[0] !== "components") return undefined;
	const kind = pointer[1] as ComponentKind;
	return componentKinds.includes(kind) ? { kind, name: pointer[2] as string } : undefined;
}

const schemaMaps = new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions",
	"dependentSchemas",
]);
const schemaLists = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaValues = new Set([
	"items",
	"additionalProperties",
	"not",
	"contains",
	"if",
	"then",
	"else",
	"propertyNames",
	"unevaluatedItems",
	"unevaluatedProperties",
	"additionalItems",
]);

/** Whether a pointer reaches a schema: from a schema root, through schema keywords only. */
function reachesSchema(doc: Json, pointer: readonly string[]): boolean {
	let i: number;
	if (pointer[0] === "components" && pointer[1] === "schemas" && pointer.length > 3) i = 3;
	else {
		// The `schema` of a parameter, header or media type.
		const root = pointer.indexOf("schema");
		if (root < 0) return false;
		i = root + 1;
	}
	while (i < pointer.length) {
		const key = pointer[i] as string;
		if (schemaMaps.has(key) || schemaLists.has(key)) i += 2;
		else if (key === "items" && Array.isArray(resolvePointer(doc, pointer.slice(0, i + 1)))) i += 2;
		else if (schemaValues.has(key)) i += 1;
		else return false;
	}
	const target = resolvePointer(doc, pointer);
	return i === pointer.length && (isObject(target) || typeof target === "boolean");
}

interface Discriminator {
	propertyName: string;
	mapping?: Record<string, string>;
}

interface Context {
	doc: Json;
	readWriteMarkers: boolean;
	problems: Problem[];
	problemKeys: Set<string>;
	operations: string[];
	/** operationId -> location of its first use. */
	operationIds: Map<string, Location>;
	usesWithRequired: boolean;
	discriminators: Map<string, Discriminator>;
	discriminatorRefsHandled: Set<string>;
	/** Type alias names for component schemas on an eager reference cycle (see `analyzeRefCycles`). */
	schemaAliases: Map<string, string>;
	aliasDeclarations: string[];
	/** Components on a $ref cycle without an object or array in between, by node key: typed `unknown`. */
	refCycles: Set<string>;
	/** Pointers of schemas being inlined (`$ref`s into schemas), to stop at a cycle. */
	inlining: Set<string>;
}

function report(ctx: Context, location: Location, code: ProblemCode, message: string): void {
	const pointer = segments(location);
	const key = `${code}\0${pointer.join("\0")}`;
	if (ctx.problemKeys.has(key)) return;
	ctx.problemKeys.add(key);
	ctx.problems.push({ pointer, code, message: `${message} (at ${formatPointer(pointer)})` });
}

/** Like upstream, patches discriminator properties into `doc` in place: pass a fresh parse. */
export function generateOpenApiTypes(doc: unknown, options: GenerateOptions = {}): GenerateResult {
	const problems: Problem[] = [];
	const fatal = (pointer: string[], message: string): GenerateResult => ({
		text: undefined,
		problems: [{ pointer, message, code: ProblemCode.UnsupportedDocument }],
	});
	if (!isObject(doc)) return fatal([], "An OpenAPI document must be a JSON object.");
	if ("swagger" in doc) {
		return fatal(
			["swagger"],
			"Swagger 2.0 is not supported: convert the document to OpenAPI 3.0 or 3.1.",
		);
	}
	if (typeof doc.openapi !== "string" || !/^3\.[01]\.\d+/.test(doc.openapi)) {
		return fatal(
			"openapi" in doc ? ["openapi"] : [],
			`Unsupported OpenAPI version ${JSON.stringify(doc.openapi ?? null)}: inspex supports OpenAPI 3.0 and 3.1.`,
		);
	}
	const ctx: Context = {
		doc,
		readWriteMarkers: options.readWriteMarkers === true,
		problems,
		problemKeys: new Set(),
		operations: [],
		operationIds: new Map(),
		usesWithRequired: false,
		discriminators: new Map(),
		discriminatorRefsHandled: new Set(),
		schemaAliases: new Map(),
		aliasDeclarations: [],
		refCycles: new Set(),
		inlining: new Set(),
	};
	scanDiscriminators(ctx);
	analyzeRefCycles(ctx);

	let paths = "export type paths = Record<string, never>;\n";
	if (isObject(doc.paths)) {
		const members: string[] = [];
		for (const [url, item] of Object.entries(doc.paths)) {
			const location = at(undefined, "paths", url);
			if (!isObject(item)) {
				report(ctx, location, ProblemCode.InvalidValue, "Expected a path item object; left out");
				continue;
			}
			const type =
				"$ref" in item
					? refType(ctx, item.$ref, at(location, "$ref"), "pathItems")
					: pathItem(ctx, item, `#/paths/${escapePointer(url)}`, location);
			members.push(`${jsDoc(item)}${propertyKey(url)}: ${type.text};`);
		}
		if (members.length) paths = `export interface paths {\n${members.join("\n")}\n}\n`;
	}
	if (isObject(doc.webhooks)) {
		// Only for their operations, as upstream does; the `webhooks` type itself is not exported.
		for (const [name, item] of Object.entries(doc.webhooks)) {
			if (isObject(item) && !("$ref" in item)) {
				pathItem(ctx, item, `#/webhooks/${escapePointer(name)}`, at(undefined, "webhooks", name));
			}
		}
	}
	const componentsObject = isObject(doc.components) ? doc.components : {};
	const components = `export interface components {\n${componentsMembers(ctx, componentsObject).join("\n")}\n}\n`;
	const operations = `export interface operations {\n${ctx.operations.join("\n")}\n}\n`;
	const text =
		(ctx.readWriteMarkers ? readWriteHelpers : "") +
		paths +
		components +
		operations +
		ctx.aliasDeclarations.join("") +
		(ctx.usesWithRequired ? withRequiredHelper : "");
	return { text, problems };
}

function componentsMembers(ctx: Context, components: Json): string[] {
	const out: string[] = [];
	for (const kind of componentKinds) {
		const items: string[] = [];
		const group = components[kind];
		if (isObject(group)) {
			for (const [name, item] of Object.entries(group)) {
				const path = `#/components/${kind}/${escapePointer(name)}`;
				const location = at(undefined, "components", kind, name);
				let type = ctx.refCycles.has(nodeKey(kind, name))
					? UNKNOWN
					: componentType(ctx, kind, item, path, location);
				const alias = kind === "schemas" ? ctx.schemaAliases.get(name) : undefined;
				if (alias) {
					ctx.aliasDeclarations.push(`type ${alias} = ${type.text};\n`);
					type = atom(alias);
				}
				items.push(`${jsDoc(item)}${propertyKey(name)}: ${type.text};`);
			}
		}
		out.push(`${kind}: ${items.length ? objectType(items).text : "never"};`);
	}
	return out;
}

function componentType(
	ctx: Context,
	kind: ComponentKind,
	item: unknown,
	path: string,
	location: Location,
): Type {
	if (kind === "schemas") return schemaType(ctx, item, path, location);
	// An alias of another component has its target's type.
	if (isObject(item) && "$ref" in item) return refType(ctx, item.$ref, at(location, "$ref"), kind);
	if (!isObject(item)) {
		report(
			ctx,
			location,
			ProblemCode.InvalidValue,
			`Expected an object in components.${kind}; typed as unknown`,
		);
		return UNKNOWN;
	}
	switch (kind) {
		case "responses":
			return responseType(ctx, item, path, location);
		case "parameters":
			return parameterType(ctx, item, path, location);
		case "requestBodies":
			return requestBodyType(ctx, item, path, location);
		case "headers":
			return headerType(ctx, item, path, location);
		case "pathItems":
			return pathItem(ctx, item, path, location);
	}
}

/** Where a `$ref` is: in a schema, an operation, or in place of a component of one kind. */
type RefPlace = "schema" | "operation" | Exclude<ComponentKind, "schemas">;

/** The referenced type, or `unknown` after reporting why it cannot be referenced. */
function refType(ctx: Context, value: unknown, location: Location, place: RefPlace): Type {
	if (typeof value !== "string") {
		report(ctx, location, ProblemCode.InvalidValue, "$ref must be a string; typed as unknown");
		return UNKNOWN;
	}
	if (!value.startsWith("#/")) {
		report(
			ctx,
			location,
			ProblemCode.UnsupportedRef,
			`External $ref "${value}" is not supported (inspex reads one file); typed as unknown`,
		);
		return UNKNOWN;
	}
	const pointer = parsePointer(value);
	const target = pointer && resolvePointer(ctx.doc, pointer);
	if (!pointer || target === undefined) {
		report(
			ctx,
			location,
			ProblemCode.UnresolvableRef,
			`Cannot resolve $ref "${value}"; typed as unknown`,
		);
		return UNKNOWN;
	}
	const component = componentOf(pointer);
	const kind = place === "schema" ? "schemas" : place;
	if (component?.kind === kind) {
		const alias = kind === "schemas" ? ctx.schemaAliases.get(component.name) : undefined;
		return atom(alias ?? `components[${JSON.stringify(kind)}][${JSON.stringify(component.name)}]`);
	}
	// Upstream indexes the component type along the pointer, which does not compile through optional
	// properties, `items` and the like; the schema the pointer reaches is inlined instead.
	if (place === "schema" && !component && reachesSchema(ctx.doc, pointer)) {
		const key = pointer.join("\0");
		if (ctx.inlining.has(key)) {
			report(
				ctx,
				location,
				ProblemCode.RefCycle,
				`$ref "${value}" leads back to itself through $refs only, so it has no type; typed as unknown`,
			);
			return UNKNOWN;
		}
		ctx.inlining.add(key);
		try {
			return schemaType(
				ctx,
				target,
				`#/${pointer.map(escapePointer).join("/")}`,
				at(undefined, ...pointer),
			);
		} finally {
			ctx.inlining.delete(key);
		}
	}
	report(
		ctx,
		location,
		ProblemCode.UnsupportedRef,
		place === "schema"
			? `$ref "${value}" does not point to a schema; typed as unknown`
			: place === "operation"
				? `An operation cannot be a $ref ("${value}"); typed as unknown`
				: `$ref "${value}" must point to #/components/${place}/<name> here; typed as unknown`,
	);
	return UNKNOWN;
}

function resolvePointer(doc: unknown, pointer: readonly string[]): unknown {
	let node = doc;
	for (const key of pointer) {
		if (typeof node !== "object" || node === null || !Object.hasOwn(node, key)) return undefined;
		node = (node as Json)[key];
	}
	return node;
}

/**
 * Upstream's resolver: truthy steps, following `$ref` chains. Used where upstream decides with it, but on
 * own properties only (upstream also finds `constructor` and the like on Object.prototype).
 */
function resolveRefLoosely(doc: Json, ref: unknown, visited: string[] = []): unknown {
	const pointer = parsePointer(ref);
	if (!pointer) return undefined;
	let node: unknown = doc;
	for (const key of pointer) {
		if (key === "") continue;
		if ((isObject(node) || Array.isArray(node)) && Object.hasOwn(node, key)) {
			const next = (node as Json)[key];
			if (!next) return undefined;
			node = next;
		} else return undefined;
	}
	if (isObject(node) && typeof node.$ref === "string") {
		if (visited.includes(node.$ref)) return undefined;
		return resolveRefLoosely(doc, node.$ref, [...visited, node.$ref]);
	}
	return node;
}

function schemaType(ctx: Context, schema: unknown, path: string, location: Location): Type {
	if (schema === true) return UNKNOWN;
	if (!schema) return NEVER;
	if (!isObject(schema)) {
		report(ctx, location, ProblemCode.InvalidValue, "Expected a schema object; typed as unknown");
		return UNKNOWN;
	}
	if ("$ref" in schema) return refType(ctx, schema.$ref, at(location, "$ref"), "schema");
	if (schema.const !== null && schema.const !== undefined) return literal(schema.const);
	if (
		Array.isArray(schema.enum) &&
		schema.type !== "object" &&
		!("properties" in schema) &&
		!("additionalProperties" in schema)
	) {
		const members = schema.enum.map(literal);
		if ((Array.isArray(schema.type) && schema.type.includes("null")) || schema.nullable)
			members.push(NULL);
		return union(members);
	}

	let final: Type | undefined;
	const core = schemaCore(ctx, schema, path, location);
	const allOf = allOfTypes(ctx, schema, path, location);
	if (core || allOf.length) {
		const allOfType = allOf.length ? intersection(allOf) : undefined;
		final = intersection([...(core ? [core] : []), ...(allOfType ? [allOfType] : [])]);
	}
	const unionItems = (key: "anyOf" | "oneOf", items: unknown): Type[] =>
		Array.isArray(items)
			? items.map((item, i) => schemaType(ctx, item, `${path}/${key}/${i}`, at(location, key, i)))
			: [];
	const anyOf = unionItems("anyOf", schema.anyOf);
	if (anyOf.length) final = union([...(final ? [final] : []), ...anyOf]);
	const oneOf = unionItems(
		"oneOf",
		schema.oneOf || (schema.type === "object" && schema.enum) || [],
	);
	if (oneOf.length) {
		final = oneOf.every((t) => primitiveTexts.has(t.text))
			? union([...(final ? [final] : []), ...oneOf])
			: intersection([...(final ? [final] : []), union(oneOf)]);
	}
	// Upstream gives `Record<string, never>` here, which makes every read of such an object `never`.
	final ??= "type" in schema ? atom("Record<string, unknown>") : UNKNOWN;
	if (final !== UNKNOWN && schema.nullable) final = union([final, NULL]);
	return final;
}

function allOfTypes(ctx: Context, schema: Json, path: string, location: Location): Type[] {
	if (!Array.isArray(schema.allOf)) return [];
	const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
	return schema.allOf.map((item: unknown, i) => {
		const itemLocation = at(location, "allOf", i);
		let type: Type;
		if (isObject(item) && "$ref" in item) {
			type = schemaType(ctx, item, path, itemLocation);
			const resolved = resolveRefLoosely(ctx.doc, item.$ref);
			if (
				isObject(resolved) &&
				"properties" in resolved &&
				!ctx.discriminatorRefsHandled.has(item.$ref as string)
			) {
				const properties = isObject(resolved.properties) ? resolved.properties : {};
				const keys = required.filter(
					(k): k is string =>
						typeof k === "string" && Object.hasOwn(properties, k) && !!properties[k],
				);
				if (keys.length) {
					ctx.usesWithRequired = true;
					type = atom(`WithRequired<${type.text}, ${union(keys.map(literal)).text}>`);
				}
			}
		} else if (isObject(item)) {
			const itemRequired = [...required, ...(Array.isArray(item.required) ? item.required : [])];
			type = schemaType(ctx, { ...item, required: itemRequired }, path, itemLocation);
		} else {
			type = schemaType(ctx, item, path, itemLocation);
		}
		const discriminator =
			(isObject(item) && typeof item.$ref === "string" && ctx.discriminators.get(item.$ref)) ||
			(isObject(item) && isObject(item.discriminator) ? item.discriminator : undefined);
		if (discriminator) {
			return atom(`Omit<${type.text}, ${literal(discriminator.propertyName).text}>`);
		}
		return type;
	});
}

function schemaCore(
	ctx: Context,
	schema: Json,
	path: string,
	location: Location,
): Type | undefined {
	const { type } = schema;
	if (type) {
		if (type === "null") return NULL;
		if (type === "string") return STRING;
		if (type === "number" || type === "integer") return NUMBER;
		if (type === "boolean") return BOOLEAN;
		if (type === "array") return arrayType(ctx, schema, path, location);
		if (Array.isArray(type)) {
			const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
			const members: Type[] = [];
			for (const t of type) {
				if (
					oneOf &&
					["boolean", "string", "number", "integer", "null"].includes(t) &&
					oneOf.some((o) => isObject(o) && o.type === t)
				) {
					continue;
				}
				members.push(
					t === "null" || t === null
						? NULL
						: schemaType(
								ctx,
								{ ...schema, type: t, ...(oneOf && { oneOf: undefined }) },
								path,
								location,
							),
				);
			}
			return union(members);
		}
	}

	const members: string[] = [];
	if (schema.allOf || schema.anyOf) {
		const discriminator =
			!schema.discriminator &&
			!ctx.discriminatorRefsHandled.has(path) &&
			ctx.discriminators.get(path);
		if (discriminator) members.push(discriminatorProperty(discriminator, path));
	}
	const properties = isObject(schema.properties) ? schema.properties : {};
	const additional = schema.additionalProperties;
	const patterns = isObject(schema.patternProperties) ? schema.patternProperties : undefined;
	if (!(Object.keys(properties).length || additional || schema.patternProperties || schema.$defs)) {
		return members.length ? objectType(members) : undefined;
	}
	const required = Array.isArray(schema.required) ? schema.required : [];
	for (const [name, value] of Object.entries(properties)) {
		const propertyLocation = at(location, "properties", name);
		if (!isObject(value) && typeof value !== "boolean") {
			report(
				ctx,
				propertyLocation,
				ProblemCode.InvalidValue,
				"Expected a schema object; typed as unknown",
			);
		}
		const hasDefault = isObject(value) && value.default !== undefined;
		// Upstream's default `defaultNonNullable`: a property with a default is present in responses.
		const optional = !(
			required.includes(name) ||
			(hasDefault &&
				!path.includes("parameters") &&
				!path.includes("requestBody") &&
				!path.includes("requestBodies"))
		);
		const valueType = isObject(value)
			? schemaType(ctx, value, `${path}/${escapePointer(name)}`, propertyLocation)
			: typeof value === "boolean"
				? schemaType(ctx, value, path, propertyLocation)
				: UNKNOWN;
		members.push(propertySignature(ctx, value, name, optional, valueType));
	}
	if (isObject(schema.$defs) && Object.keys(schema.$defs).length) {
		const defs = Object.entries(schema.$defs).map(([name, value]) =>
			propertySignature(
				ctx,
				value,
				name,
				false,
				schemaType(ctx, value, `${path}/$defs/${escapePointer(name)}`, at(location, "$defs", name)),
			),
		);
		members.push(`$defs: ${objectType(defs).text};`);
	}
	const indexTypes: Type[] = [];
	if (isObject(additional) && Object.keys(additional).length) {
		indexTypes.push(schemaType(ctx, additional, path, at(location, "additionalProperties")));
	}
	if (additional === true || (isObject(additional) && !Object.keys(additional).length)) {
		indexTypes.push(UNKNOWN);
	}
	if (patterns) {
		for (const [pattern, value] of Object.entries(patterns)) {
			indexTypes.push(schemaType(ctx, value, path, at(location, "patternProperties", pattern)));
		}
	}
	if (!indexTypes.length) return members.length ? objectType(members) : undefined;
	return intersection([
		...(members.length ? [objectType(members)] : []),
		atom(`{\n[key: string]: ${union(indexTypes).text};\n}`),
	]);
}

function propertySignature(
	ctx: Context,
	schema: unknown,
	name: string,
	optional: boolean,
	type: Type,
): string {
	const readOnly = isObject(schema) && !!schema.readOnly;
	const writeOnly = isObject(schema) && !!schema.writeOnly;
	let valueType = type.text;
	if (ctx.readWriteMarkers && readOnly !== writeOnly) {
		valueType = `${readOnly ? "$Read" : "$Write"}<${valueType}>`;
	}
	const modifier = !ctx.readWriteMarkers && readOnly ? "readonly " : "";
	return `${jsDoc(schema)}${modifier}${propertyKey(name)}${optional ? "?" : ""}: ${valueType};`;
}

function arrayType(ctx: Context, schema: Json, path: string, location: Location): Type {
	const prefixItems =
		schema.prefixItems ?? (Array.isArray(schema.items) ? schema.items : undefined);
	let item = UNKNOWN;
	if (Array.isArray(prefixItems)) {
		const key = schema.prefixItems ? "prefixItems" : "items";
		const members = prefixItems.map((p, i) => schemaType(ctx, p, path, at(location, key, i)).text);
		item = { text: `[${members.join(", ")}]`, kind: "tuple" };
	} else if (schema.items) {
		const items = schemaType(ctx, schema.items, path, at(location, "items"));
		item = isObject(schema.items) && schema.items.type === "array" ? arrayOf(items) : items;
	}
	return item.kind === "tuple" || item.kind === "array" ? item : arrayOf(item);
}

function discriminatorProperty(discriminator: Discriminator, path: string): string {
	let value = lastSegment(path);
	if (isObject(discriminator.mapping)) {
		const match = Object.entries(discriminator.mapping).find(([, v]) =>
			typeof v === "string" && v.startsWith("#") ? lastSegment(v) === value : v === value,
		);
		if (match) value = match[0];
	}
	return `${propertyKey(discriminator.propertyName)}: ${literal(value).text};`;
}

function lastSegment(ref: string): string {
	const parts = (parsePointer(ref.slice(ref.indexOf("#"))) ?? []).filter(Boolean);
	return parts.at(-1) ?? "";
}

interface LocatedParameter {
	parameter: unknown;
	location: Location;
}

function pathItem(ctx: Context, item: Json, path: string, location: Location): Type {
	const shared = locatedList(item.parameters, at(location, "parameters"));
	const members = [parametersMember(ctx, shared, `${path}/parameters`)];
	for (const method of methods) {
		const operation = item[method];
		const operationLocation = at(location, method);
		if (!operation) {
			members.push(`${method}?: never;`);
			continue;
		}
		if (!isObject(operation)) {
			report(ctx, operationLocation, ProblemCode.InvalidValue, "Expected an operation object");
			members.push(`${method}?: never;`);
			continue;
		}
		const operationPath = `${path}/${method}`;
		let type: Type;
		if ("$ref" in operation) {
			type = refType(ctx, operation.$ref, at(operationLocation, "$ref"), "operation");
		} else {
			// An operation's parameter replaces the path item's one with the same name and location.
			const merged = new Map<string, LocatedParameter>();
			for (const entry of [
				...shared,
				...locatedList(operation.parameters, at(operationLocation, "parameters")),
			]) {
				const resolved = resolveParameter(ctx, entry);
				if (resolved) merged.set(nodeKey(resolved.in as string, resolved.name as string), entry);
			}
			const parameters = [...merged.values()];
			const id = operation.operationId;
			const firstUse = typeof id === "string" && id ? ctx.operationIds.get(id) : undefined;
			if (typeof id === "string" && id && firstUse) {
				report(
					ctx,
					at(operationLocation, "operationId"),
					ProblemCode.DuplicateOperationId,
					`Duplicate operationId "${id}", first used at ${formatPointer(segments(firstUse))}; this operation is typed inline in paths and left out of operations`,
				);
			}
			const operationType = objectType(
				operationMembers(ctx, operation, parameters, operationPath, operationLocation),
			);
			if (typeof id === "string" && id && !firstUse) {
				// Upstream replaces "#" with "/" here, so "a#b" and "a/b" collide; inspex keeps the operationId.
				ctx.operationIds.set(id, at(operationLocation, "operationId"));
				ctx.operations.push(`${propertyKey(id)}: ${operationType.text};`);
				type = atom(`operations[${JSON.stringify(id)}]`);
			} else {
				type = operationType;
			}
		}
		members.push(`${jsDoc(operation)}${method}: ${type.text};`);
	}
	return objectType(members);
}

function locatedList(value: unknown, location: Location): LocatedParameter[] {
	return Array.isArray(value)
		? value.map((parameter, i) => ({ parameter, location: at(location, i) }))
		: [];
}

function operationMembers(
	ctx: Context,
	operation: Json,
	parameters: LocatedParameter[],
	path: string,
	location: Location,
): string[] {
	const members = [parametersMember(ctx, parameters, path)];
	const body = operation.requestBody;
	if (isObject(body)) {
		const bodyLocation = at(location, "requestBody");
		const type =
			"$ref" in body
				? refType(ctx, body.$ref, at(bodyLocation, "$ref"), "requestBodies")
				: requestBodyType(ctx, body, `${path}/requestBody`, bodyLocation);
		const resolved = "$ref" in body ? resolveRefLoosely(ctx.doc, body.$ref) : body;
		const required = isObject(resolved) && !!resolved.required;
		members.push(`${jsDoc(body)}requestBody${required ? "" : "?"}: ${type.text};`);
	} else {
		members.push("requestBody?: never;");
	}
	const responses = isObject(operation.responses) ? operation.responses : {};
	members.push(
		`responses: ${responsesType(ctx, responses, path, at(location, "responses")).text};`,
	);
	return members;
}

/**
 * The parameter object an entry stands for, or undefined after reporting why it is left out: an
 * unresolved `$ref`, or no string `name` and `in` of query, header, path or cookie.
 */
function resolveParameter(
	ctx: Context,
	{ parameter, location }: LocatedParameter,
): Json | undefined {
	let resolved = parameter;
	if (isObject(parameter) && "$ref" in parameter) {
		resolved = resolveRefLoosely(ctx.doc, parameter.$ref);
		if (!isObject(resolved)) {
			refType(ctx, parameter.$ref, at(location, "$ref"), "parameters");
			return undefined;
		}
	}
	if (!isObject(resolved)) {
		report(ctx, location, ProblemCode.InvalidValue, "Expected a parameter object; left out");
		return undefined;
	}
	if (
		typeof resolved.name !== "string" ||
		!parameterLocations.includes(resolved.in as (typeof parameterLocations)[number])
	) {
		report(
			ctx,
			location,
			ProblemCode.InvalidValue,
			'A parameter needs a string "name" and an "in" of query, header, path or cookie; left out',
		);
		return undefined;
	}
	return resolved;
}

function parametersMember(ctx: Context, parameters: LocatedParameter[], path: string): string {
	const resolved = parameters.flatMap((entry) => {
		const p = resolveParameter(ctx, entry);
		return p ? [{ ...entry, resolved: p }] : [];
	});
	const groups = parameterLocations.map((where) => {
		const members: string[] = [];
		let allOptional = true;
		for (const { parameter, location, resolved: p } of resolved) {
			if (p.in !== where) continue;
			const name = p.name as string;
			const optional = where !== "path" && !p.required;
			allOptional &&= optional;
			const type =
				isObject(parameter) && "$ref" in parameter
					? refType(ctx, parameter.$ref, at(location, "$ref"), "parameters")
					: parameterType(ctx, p, `${path}/parameters/${where}/${escapePointer(name)}`, location);
			members.push(`${jsDoc(p)}${propertyKey(name)}${optional ? "?" : ""}: ${type.text};`);
		}
		return `${where}${allOptional ? "?" : ""}: ${members.length ? objectType(members).text : "never"};`;
	});
	return `parameters: ${objectType(groups).text};`;
}

function parameterType(ctx: Context, parameter: Json, path: string, location: Location): Type {
	return parameter.schema
		? schemaType(ctx, parameter.schema, path, at(location, "schema"))
		: STRING;
}

function contentMembers(
	ctx: Context,
	content: unknown,
	path: string,
	location: Location,
	allowRef: boolean,
): string[] {
	if (!isObject(content)) return [];
	return Object.entries(content).map(([mediaType, media]) => {
		const mediaPath = `${path}/content/${escapePointer(mediaType)}`;
		const mediaLocation = at(location, "content", mediaType);
		let type: Type;
		if (!isObject(media)) {
			report(
				ctx,
				mediaLocation,
				ProblemCode.InvalidValue,
				"Expected a media type object; typed as unknown",
			);
			type = UNKNOWN;
		} else if (allowRef && "$ref" in media) {
			type = schemaType(ctx, media, mediaPath, mediaLocation);
		} else {
			type = media.schema
				? schemaType(ctx, media.schema, mediaPath, at(mediaLocation, "schema"))
				: UNKNOWN;
		}
		return `${jsDoc(media)}${propertyKey(mediaType)}: ${type.text};`;
	});
}

function requestBodyType(ctx: Context, body: Json, path: string, location: Location): Type {
	const members = contentMembers(ctx, body.content, path, location, true);
	return objectType([
		`content: ${objectType(members.length ? members : ['"*/*"?: never;']).text};`,
	]);
}

function responsesType(ctx: Context, responses: Json, path: string, location: Location): Type {
	const members = Object.entries(responses).map(([status, response]) => {
		const responseLocation = at(location, status);
		let type: Type;
		if (!isObject(response)) {
			report(
				ctx,
				responseLocation,
				ProblemCode.InvalidValue,
				"Expected a response object; typed as unknown",
			);
			type = UNKNOWN;
		} else if ("$ref" in response) {
			type = refType(ctx, response.$ref, at(responseLocation, "$ref"), "responses");
		} else {
			type = responseType(
				ctx,
				response,
				`${path}/responses/${escapePointer(status)}`,
				responseLocation,
			);
		}
		return `${jsDoc(response)}${propertyKey(status)}: ${type.text};`;
	});
	return members.length ? objectType(members) : NEVER;
}

function responseType(ctx: Context, response: Json, path: string, location: Location): Type {
	const headers: string[] = [];
	if (isObject(response.headers)) {
		for (const [name, header] of Object.entries(response.headers)) {
			const headerLocation = at(location, "headers", name);
			let type: Type;
			let optional = true;
			if (!isObject(header)) {
				report(
					ctx,
					headerLocation,
					ProblemCode.InvalidValue,
					"Expected a header object; typed as unknown",
				);
				type = UNKNOWN;
			} else if ("$ref" in header) {
				type = refType(ctx, header.$ref, at(headerLocation, "$ref"), "headers");
				optional = false;
			} else {
				type = headerType(ctx, header, `${path}/headers/${escapePointer(name)}`, headerLocation);
				optional = !header.required;
			}
			headers.push(`${jsDoc(header)}${propertyKey(name)}${optional ? "?" : ""}: ${type.text};`);
		}
	}
	headers.push("[name: string]: unknown;");
	const content = contentMembers(ctx, response.content, path, location, false);
	return objectType([
		`headers: ${objectType(headers).text};`,
		content.length ? `content: ${objectType(content).text};` : "content?: never;",
	]);
}

function headerType(ctx: Context, header: Json, path: string, location: Location): Type {
	if (header.schema) return schemaType(ctx, header.schema, path, at(location, "schema"));
	if (header.content) {
		const members = contentMembers(ctx, header.content, path, location, true);
		return objectType(members);
	}
	return UNKNOWN;
}

// TypeScript resolves union and intersection members, array elements and type alias targets eagerly, and
// object members lazily. So components that refer to each other only through `$ref`s, unions and
// intersections (`A: B; B: A`, or `C: C | string`) have no type (TS2502, TS2456): they are reported and
// typed `unknown`. Through an array, recursion has a type, but not as an indexed access
// (`X: components["schemas"]["X"][]` is TS2502): those schemas get a type alias, which may refer to itself
// there, and references to them use it.
function analyzeRefCycles(ctx: Context): void {
	const components = isObject(ctx.doc.components) ? ctx.doc.components : {};
	const direct = new Map<string, Set<string>>();
	const eager = new Map<string, Set<string>>();
	const names = new Map<string, { kind: ComponentKind; name: string }>();
	for (const kind of componentKinds) {
		const group = components[kind];
		if (!isObject(group)) continue;
		for (const [name, item] of Object.entries(group)) {
			const node = nodeKey(kind, name);
			names.set(node, { kind, name });
			const directRefs = new Set<string>();
			if (kind === "schemas") {
				schemaRefs(ctx.doc, item, false, directRefs, new Set());
				const eagerRefs = new Set<string>();
				schemaRefs(ctx.doc, item, true, eagerRefs, new Set());
				eager.set(node, eagerRefs);
			} else if (isObject(item) && "$ref" in item) {
				const target = componentOf(parsePointer(item.$ref));
				if (target?.kind === kind) directRefs.add(nodeKey(kind, target.name));
			}
			direct.set(node, directRefs);
		}
	}
	for (const cycle of cycles(direct)) {
		const members = cycle.map((node) => names.get(node)?.name as string);
		for (const node of cycle) {
			const { kind, name } = names.get(node) as { kind: ComponentKind; name: string };
			ctx.refCycles.add(node);
			report(
				ctx,
				at(undefined, "components", kind, name),
				ProblemCode.RefCycle,
				`This component is on a $ref cycle with no object or array in between (${members.join(", ")}), so it has no type; typed as unknown`,
			);
		}
	}
	const used = new Set<string>();
	for (const cycle of cycles(eager)) {
		for (const node of cycle) {
			const name = names.get(node)?.name as string;
			let alias = `$schema_${name.replaceAll(/[^\w$]/g, "_")}`;
			while (used.has(alias)) alias += "_";
			used.add(alias);
			ctx.schemaAliases.set(name, alias);
		}
	}
}

/**
 * Adds the component schemas `schema` refers to eagerly: through `$ref`s (following those into other
 * schemas, which are inlined), unions and intersections, and with `throughArrays` also array items.
 */
function schemaRefs(
	doc: Json,
	schema: unknown,
	throughArrays: boolean,
	out: Set<string>,
	inlined: Set<string>,
): void {
	if (!isObject(schema)) return;
	if ("$ref" in schema) {
		const pointer = parsePointer(schema.$ref);
		const component = componentOf(pointer);
		if (component?.kind === "schemas") out.add(nodeKey("schemas", component.name));
		else if (pointer && !component && reachesSchema(doc, pointer)) {
			const key = pointer.join("\0");
			if (inlined.has(key)) return;
			inlined.add(key);
			schemaRefs(doc, resolvePointer(doc, pointer), throughArrays, out, inlined);
		}
		return;
	}
	// As in `schemaType`: a constant or an enum has no references.
	if (schema.const !== null && schema.const !== undefined) return;
	if (
		Array.isArray(schema.enum) &&
		schema.type !== "object" &&
		!("properties" in schema) &&
		!("additionalProperties" in schema)
	) {
		return;
	}
	const keys = throughArrays
		? ["allOf", "anyOf", "oneOf", "prefixItems", "items"]
		: ["allOf", "anyOf", "oneOf"];
	for (const key of keys) {
		const value = schema[key];
		for (const item of Array.isArray(value) ? value : [value]) {
			schemaRefs(doc, item, throughArrays, out, inlined);
		}
	}
}

/** Strongly connected components that are cycles (two nodes or more, or a self-reference), by Tarjan. */
function cycles(edges: Map<string, Set<string>>): string[][] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const out: string[][] = [];
	const order = new Map([...edges.keys()].map((node, i) => [node, i]));
	const visit = (node: string): void => {
		index.set(node, index.size);
		low.set(node, index.get(node) as number);
		stack.push(node);
		onStack.add(node);
		for (const next of edges.get(node) ?? []) {
			if (!edges.has(next)) continue;
			if (!index.has(next)) {
				visit(next);
				low.set(node, Math.min(low.get(node) as number, low.get(next) as number));
			} else if (onStack.has(next)) {
				low.set(node, Math.min(low.get(node) as number, index.get(next) as number));
			}
		}
		if (low.get(node) !== index.get(node)) return;
		const component: string[] = [];
		let member: string | undefined;
		do {
			member = stack.pop() as string;
			onStack.delete(member);
			component.push(member);
		} while (member !== node);
		if (component.length > 1 || edges.get(node)?.has(node)) {
			out.push(component.toSorted((a, b) => (order.get(a) as number) - (order.get(b) as number)));
		}
	};
	for (const node of edges.keys()) if (!index.has(node)) visit(node);
	return out;
}

// Mirrors openapi-typescript's `scanDiscriminators`: it records every discriminator by the JSON pointer
// of its schema, and patches the mapped schemas' discriminator property into an enum of mapped values.
function scanDiscriminators(ctx: Context): void {
	const { doc, discriminators: objects, discriminatorRefsHandled: handled } = ctx;
	walk(doc, "#", (node, path) => {
		const discriminator = node.discriminator;
		if (!isObject(discriminator) || !discriminator.propertyName) return;
		objects.set(path, discriminator as unknown as Discriminator);
		if (!Array.isArray(node.oneOf)) return;
		const mapping = new Map<string, { inferred?: string; defined?: string[] }>();
		for (const item of node.oneOf) {
			if (isObject(item) && typeof item.$ref === "string") {
				const value = item.$ref.split("/").pop();
				if (value) mapping.set(item.$ref, { ...mapping.get(item.$ref), inferred: value });
			}
		}
		if (isObject(discriminator.mapping)) {
			for (const [mappedValue, mappedRef] of Object.entries(discriminator.mapping)) {
				if (typeof mappedRef !== "string" || !mappedRef) continue;
				if (!mapping.get(mappedRef)?.defined) mapping.set(mappedRef, { defined: [] });
				mapping.get(mappedRef)?.defined?.push(mappedValue);
			}
		}
		for (const [mappedRef, { inferred, defined }] of mapping) {
			if (handled.has(mappedRef) || (!inferred && !defined)) continue;
			const values = defined ?? [inferred as string];
			if (patchDiscriminatorEnum(doc, mappedRef, values, discriminator.propertyName as string)) {
				handled.add(mappedRef);
			}
		}
	});
	if (!objects.size) return;
	walk(doc, "#", (node, path) => {
		if (!Array.isArray(node.allOf)) return;
		for (const item of node.allOf) {
			if (isObject(item) && "$ref" in item) {
				const base = typeof item.$ref === "string" ? objects.get(item.$ref) : undefined;
				if (!base) return;
				const mappedValues = isObject(base.mapping)
					? Object.keys(base.mapping).filter((value) => base.mapping?.[value] === path)
					: [];
				if (
					mappedValues.length &&
					patchDiscriminatorEnum(doc, path, mappedValues, base.propertyName)
				) {
					handled.add(path);
				}
				objects.set(path, { ...base });
			} else if (
				isObject(item) &&
				isObject(item.discriminator) &&
				item.discriminator.propertyName
			) {
				objects.set(path, { ...(item.discriminator as unknown as Discriminator) });
			}
		}
	});
}

function patchDiscriminatorEnum(
	doc: Json,
	ref: string,
	values: string[],
	propertyName: string,
): boolean {
	const schema = resolveRefLoosely(doc, ref);
	const property = { type: "string", enum: values };
	if (isObject(schema) && Array.isArray(schema.allOf)) {
		schema.allOf.push({
			type: "object",
			required: [propertyName],
			properties: { [propertyName]: property },
		});
		return true;
	}
	if (isObject(schema) && schema.type === "object") {
		if (!isObject(schema.properties)) schema.properties = {};
		if (!Array.isArray(schema.required)) schema.required = [propertyName];
		else if (!schema.required.includes(propertyName)) schema.required.push(propertyName);
		// Not `properties[name] = …`: for "__proto__" that sets the prototype (upstream's bug).
		Object.defineProperty(schema.properties, propertyName, {
			value: property,
			enumerable: true,
			writable: true,
			configurable: true,
		});
		return true;
	}
	return false;
}

function walk(node: unknown, path: string, visit: (node: Json, path: string) => void): void {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) walk(node[i], `${path}/${i}`, visit);
	} else if (isObject(node)) {
		visit(node, path);
		for (const key of Object.keys(node)) walk(node[key], `${path}/${escapePointer(key)}`, visit);
	}
}
