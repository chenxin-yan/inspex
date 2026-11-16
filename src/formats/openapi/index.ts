// OpenAPI 3.0 / 3.1 document -> declarations for `paths`, `components` and `operations`.
//
// The output equals what openapi-typescript 7 emits with its default options (so tools built on them, such
// as openapi-fetch, work unchanged), except where upstream's output is wrong or does not compile: there it
// is the correct type, or `unknown` and a problem. Each difference is named in tests/differential.test.ts
// and in docs/reference.md. Upstream quirks that do not make types wrong (the `path` strings below, discriminator
// patching) are mirrored on purpose.

import { locateJsonPointers, parseJsonc, pointerKey } from "../../jsonc.ts";
import { type MappedSpec, ProblemCode } from "../../problems.ts";
import { analyzeRefCycles, scanDiscriminators } from "./analysis.ts";
import {
	type ComponentKind,
	componentKinds,
	type Context,
	type GenerateOptions,
	type GenerateResult,
	isObject,
	type Json,
	type Location,
	type Problem,
} from "./context.ts";
import {
	headerType,
	parameterType,
	pathItem,
	requestBodyType,
	responseType,
} from "./operations.ts";
import { at, escapePointer, nodeKey, report } from "./refs.ts";
import { refType, schemaType } from "./schema.ts";
import { atom, jsDoc, objectType, propertyKey, type Type, UNKNOWN } from "./type-text.ts";

// The exact text openapi-typescript emits for `readWriteMarkers: true`, so both outputs are the same types.
const readWriteHelpers = `export type $Read<T> = { readonly $read: T };
export type $Write<T> = { readonly $write: T };
export type Readable<T> = T extends $Write<any> ? never : T extends $Read<infer U> ? Readable<U> : T extends (infer E)[] ? Readable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Write<any> ? never : K]: Readable<T[K]> } : T;
export type Writable<T> = T extends $Read<any> ? never : T extends $Write<infer U> ? Writable<U> : T extends (infer E)[] ? Writable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? never : K]: Writable<T[K]> } & { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? K : never]?: never } : T;
`;

const withRequiredHelper = "type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };\n";

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
		effectiveSchemas: new Map(),
		componentKeys: new Map(),
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
				const effective = kind === "schemas" ? (ctx.effectiveSchemas.get(name) ?? item) : item;
				let type = ctx.refCycles.has(nodeKey(kind, name))
					? UNKNOWN
					: componentType(ctx, kind, effective, path, location);
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

/** A `.openapi.jsonc` file: JSONC text in, declarations and located problems out. */
export function mapOpenApiJsonc(content: string, options: GenerateOptions): MappedSpec {
	const parsed = parseJsonc(content);
	if (!parsed.ok) {
		const { message, start, length } = parsed.error;
		return {
			text: undefined,
			problems: [
				{ start, length, code: ProblemCode.InvalidSyntax, message: `Invalid JSONC: ${message}` },
			],
		};
	}
	let result;
	try {
		result = generateOpenApiTypes(parsed.value, options);
	} catch (error) {
		const message = `inspex failed to type this spec: ${error instanceof Error ? error.message : String(error)}`;
		return {
			text: undefined,
			problems: [{ start: 0, length: 0, code: ProblemCode.InternalError, message }],
		};
	}
	// Locating needs another pass over the whole text; most specs have nothing to locate.
	if (!result.problems.length) return { text: result.text, problems: [] };
	const ranges = locateJsonPointers(
		content,
		result.problems.map((p) => p.pointer),
	);
	const problems = result.problems.map(({ pointer, message, code }) => {
		const range = ranges.get(pointerKey(pointer)) ?? { start: 0, length: 0 };
		// Underline an object or array by its opening bracket, not its whole extent.
		const bracket = /[[{]/.test(content.charAt(range.start));
		return { start: range.start, length: bracket ? 1 : range.length, message, code };
	});
	return { text: result.text, problems };
}
