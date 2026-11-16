// OpenAPI 3.0 / 3.1 document -> declarations for `paths`, `components` and `operations`.
//
// The output follows the shapes openapi-typescript 7 emits with its default options (so tools built on
// them, such as openapi-fetch, work unchanged), with the deviations listed in the README:
// - `{ type: "object" }` without properties is `Record<string, unknown>` (upstream: `Record<string, never>`,
//   upstream's `emptyObjectsUnknown` option);
// - a spec without operationIds has `interface operations {}` (upstream: `Record<string, never>`);
// - a broken part of a spec is typed `unknown` and reported, instead of failing the whole document.
// Upstream quirks that change types (the `path` strings below, discriminator patching) are mirrored on
// purpose; tests/differential.test.ts compares the two.

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
	return identifier.test(name) ? name : JSON.stringify(name);
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
function parsePointer(ref: string): string[] | undefined {
	try {
		return ref
			.slice(2)
			.split("/")
			.map((s) => decodeURIComponent(s.replaceAll("~1", "/").replaceAll("~0", "~")));
	} catch {
		return undefined;
	}
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
	/** Type alias names for component schemas on an eager reference cycle (see `recursiveSchemaAliases`). */
	schemaAliases: Map<string, string>;
	aliasDeclarations: string[];
}

function report(ctx: Context, location: Location, code: ProblemCode, message: string): void {
	const pointer = segments(location);
	const key = `${code}\0${pointer.join("\0")}`;
	if (ctx.problemKeys.has(key)) return;
	ctx.problemKeys.add(key);
	ctx.problems.push({ pointer, code, message: `${message} (at ${formatPointer(pointer)})` });
}

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
	};
	scanDiscriminators(ctx);
	if (isObject(doc.components) && isObject(doc.components.schemas)) {
		ctx.schemaAliases = recursiveSchemaAliases(doc.components.schemas);
	}

	let paths = "export type paths = Record<string, never>;\n";
	if (isObject(doc.paths)) {
		const members: string[] = [];
		for (const [url, item] of Object.entries(doc.paths)) {
			const location = at(undefined, "paths", url);
			if (!isObject(item)) continue;
			const type =
				"$ref" in item
					? refType(ctx, item.$ref, at(location, "$ref"))
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
	let components = "export type components = Record<string, never>;\n";
	if (isObject(doc.components)) {
		components = `export interface components {\n${componentsMembers(ctx, doc.components).join("\n")}\n}\n`;
	}
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
				let type = componentType(ctx, kind, item, path, location);
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

/** The referenced component's type, or `unknown` after reporting why it cannot be referenced. */
function refType(ctx: Context, value: unknown, location: Location): Type {
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
	if (!pointer || resolvePointer(ctx.doc, pointer) === undefined) {
		report(
			ctx,
			location,
			ProblemCode.UnresolvableRef,
			`Cannot resolve $ref "${value}"; typed as unknown`,
		);
		return UNKNOWN;
	}
	const [root, kind, name, ...rest] = pointer;
	// Below a component, only `properties/<name>` steps map to a type: upstream indexes every step,
	// which is wrong through `items`, `allOf` and the like.
	const propertySteps =
		rest.length % 2 === 0 && rest.every((s, i) => i % 2 === 1 || s === "properties");
	if (
		root !== "components" ||
		!componentKinds.includes(kind as ComponentKind) ||
		name === undefined ||
		!propertySteps
	) {
		report(
			ctx,
			location,
			ProblemCode.UnsupportedRef,
			`$ref "${value}" is not supported: only references to #/components/{${componentKinds.join(",")}}/<name> (and their properties) are typed; typed as unknown`,
		);
		return UNKNOWN;
	}
	const alias = kind === "schemas" && !rest.length ? ctx.schemaAliases.get(name) : undefined;
	if (alias) return atom(alias);
	const steps = [kind as string, name, ...rest.filter((_, i) => i % 2 === 1)];
	return atom(`components${steps.map((s) => `[${JSON.stringify(s)}]`).join("")}`);
}

function resolvePointer(doc: unknown, pointer: readonly string[]): unknown {
	let node = doc;
	for (const key of pointer) {
		if (typeof node !== "object" || node === null || !Object.hasOwn(node, key)) return undefined;
		node = (node as Json)[key];
	}
	return node;
}

/** Upstream's resolver: truthy steps, following `$ref` chains. Used where upstream decides with it. */
function resolveRefLoosely(doc: Json, ref: unknown, visited: string[] = []): unknown {
	if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
	let node: unknown = doc;
	for (const key of parsePointer(ref) ?? []) {
		if (key === "") continue;
		if (isObject(node) || Array.isArray(node)) {
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
	if ("$ref" in schema) return refType(ctx, schema.$ref, at(location, "$ref"));
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
				const keys = required.filter((k): k is string => typeof k === "string" && !!properties[k]);
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
			type = refType(ctx, operation.$ref, at(operationLocation, "$ref"));
		} else {
			const merged = new Map<string, LocatedParameter>();
			for (const entry of [
				...shared,
				...locatedList(operation.parameters, at(operationLocation, "parameters")),
			]) {
				const resolved =
					isObject(entry.parameter) && "$ref" in entry.parameter
						? resolveRefLoosely(ctx.doc, entry.parameter.$ref)
						: entry.parameter;
				const r = isObject(resolved) ? resolved : {};
				merged.set(`${String(r.in)}-${String(r.name)}`, entry);
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
				ctx.operationIds.set(id, at(operationLocation, "operationId"));
				const key = id.replaceAll("#", "/");
				ctx.operations.push(`${propertyKey(key)}: ${operationType.text};`);
				type = atom(`operations[${JSON.stringify(key)}]`);
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
				? refType(ctx, body.$ref, at(bodyLocation, "$ref"))
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

function parametersMember(ctx: Context, parameters: LocatedParameter[], path: string): string {
	const resolved = parameters.map(({ parameter, location }) => {
		if (isObject(parameter) && "$ref" in parameter) {
			const target = resolveRefLoosely(ctx.doc, parameter.$ref);
			if (!isObject(target)) refType(ctx, parameter.$ref, at(location, "$ref"));
			return { parameter, location, resolved: isObject(target) ? target : undefined };
		}
		if (!isObject(parameter)) {
			report(ctx, location, ProblemCode.InvalidValue, "Expected a parameter object; left out");
		}
		return { parameter, location, resolved: isObject(parameter) ? parameter : undefined };
	});
	const groups = parameterLocations.map((where) => {
		const members: string[] = [];
		let allOptional = true;
		for (const { parameter, location, resolved: p } of resolved) {
			if (p?.in !== where) continue;
			const optional = where !== "path" && !p.required;
			allOptional &&= optional;
			const type =
				isObject(parameter) && "$ref" in parameter
					? refType(ctx, parameter.$ref, at(location, "$ref"))
					: parameterType(
							ctx,
							p,
							`${path}/parameters/${where}/${escapePointer(String(p.name))}`,
							location,
						);
			members.push(
				`${jsDoc(p)}${propertyKey(String(p.name))}${optional ? "?" : ""}: ${type.text};`,
			);
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
			type = refType(ctx, response.$ref, at(responseLocation, "$ref"));
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
				type = refType(ctx, header.$ref, at(headerLocation, "$ref"));
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

// `X: components["schemas"]["X"][] | string` is TS2502 (circular), because TypeScript resolves array
// elements and union members eagerly; a type alias may refer to itself there. So component schemas on
// such a cycle get a type alias, and references to them use it. Object members are resolved lazily,
// so references inside `properties` and `additionalProperties` do not count.
function recursiveSchemaAliases(schemas: Json): Map<string, string> {
	const edges = new Map<string, Set<string>>();
	for (const [name, schema] of Object.entries(schemas)) {
		const refs = new Set<string>();
		eagerSchemaRefs(schema, refs);
		edges.set(name, refs);
	}
	// Tarjan's strongly connected components; a node is on a cycle if its component has two nodes or a self-edge.
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const recursive: string[] = [];
	const visit = (name: string): void => {
		index.set(name, index.size);
		low.set(name, index.get(name) as number);
		stack.push(name);
		onStack.add(name);
		for (const next of edges.get(name) ?? []) {
			if (!edges.has(next)) continue;
			if (!index.has(next)) {
				visit(next);
				low.set(name, Math.min(low.get(name) as number, low.get(next) as number));
			} else if (onStack.has(next)) {
				low.set(name, Math.min(low.get(name) as number, index.get(next) as number));
			}
		}
		if (low.get(name) !== index.get(name)) return;
		const component: string[] = [];
		let member: string | undefined;
		do {
			member = stack.pop() as string;
			onStack.delete(member);
			component.push(member);
		} while (member !== name);
		if (component.length > 1 || edges.get(name)?.has(name)) recursive.push(...component);
	};
	for (const name of edges.keys()) if (!index.has(name)) visit(name);
	const aliases = new Map<string, string>();
	const used = new Set<string>();
	for (const name of recursive) {
		let alias = `$schema_${name.replaceAll(/[^\w$]/g, "_")}`;
		while (used.has(alias)) alias += "_";
		used.add(alias);
		aliases.set(name, alias);
	}
	return aliases;
}

function eagerSchemaRefs(schema: unknown, out: Set<string>): void {
	if (!isObject(schema)) return;
	if ("$ref" in schema) {
		const pointer = typeof schema.$ref === "string" ? parsePointer(schema.$ref) : undefined;
		if (pointer?.length === 3 && pointer[0] === "components" && pointer[1] === "schemas") {
			out.add(pointer[2] as string);
		}
		return;
	}
	for (const key of ["allOf", "anyOf", "oneOf", "prefixItems", "items"]) {
		const value = schema[key];
		for (const item of Array.isArray(value) ? value : [value]) eagerSchemaRefs(item, out);
	}
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
		(schema.properties as Json)[propertyName] = property;
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
