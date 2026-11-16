// JSON pointers and locations: parsing, resolving, whether a pointer reaches a schema, and reporting problems.

import { ProblemCode } from "../../problems.ts";
import {
	type ComponentKind,
	componentKinds,
	type Context,
	isObject,
	type Json,
	type Location,
	methods,
} from "./context.ts";

export function at(location: Location, ...keys: (string | number)[]): Location {
	let result = location;
	for (const key of keys) result = { up: result, key: String(key) };
	return result;
}
export function segments(location: Location): string[] {
	const out: string[] = [];
	for (let l = location; l; l = l.up) out.push(l.key);
	return out.toReversed();
}

export function formatPointer(pointer: readonly string[]): string {
	return `#${pointer.map((s) => `/${escapePointer(s)}`).join("")}`;
}
export function escapePointer(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
/** The segments of a local `$ref` ("#/..."), or undefined for anything else. */
export function parsePointer(ref: unknown): string[] | undefined {
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

export const nodeKey = (kind: string, name: string): string => `${kind}\0${name}`;

/** `#/components/<kind>/<name>` as kind and name, or undefined. */
export function componentOf(
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

/** What the value at a position of an OpenAPI document is, as far as schema positions go. */
type Position =
	| "root"
	| "components"
	| "callback"
	| "pathItem"
	| "operation"
	| "parameter"
	| "requestBody"
	| "response"
	| "media"
	| "schema"
	/** A map or list whose every member is the given position. */
	| { each: Position };

const positionSteps: Partial<Record<Exclude<Position, object>, Record<string, Position>>> = {
	root: { components: "components", paths: { each: "pathItem" }, webhooks: { each: "pathItem" } },
	components: {
		schemas: { each: "schema" },
		parameters: { each: "parameter" },
		headers: { each: "parameter" },
		responses: { each: "response" },
		requestBodies: { each: "requestBody" },
		pathItems: { each: "pathItem" },
		callbacks: { each: "callback" },
	},
	callback: {},
	pathItem: {
		parameters: { each: "parameter" },
		...Object.fromEntries(methods.map((method) => [method, "operation"])),
	},
	operation: {
		parameters: { each: "parameter" },
		requestBody: "requestBody",
		responses: { each: "response" },
		callbacks: { each: "callback" },
	},
	// A parameter or a header.
	parameter: { schema: "schema", content: { each: "media" } },
	requestBody: { content: { each: "media" } },
	response: { headers: { each: "parameter" }, content: { each: "media" } },
	media: { schema: "schema" },
};

/**
 * Whether a pointer reaches a Schema Object, by walking the document's structure from its root (never by
 * how a segment is spelled: a response may be named "schema").
 */
export function reachesSchema(doc: Json, pointer: readonly string[]): boolean {
	let position: Position = "root";
	let node: unknown = doc;
	for (const key of pointer) {
		if (typeof position === "object") position = position.each;
		else if (position === "callback") position = "pathItem";
		else if (position === "schema") {
			if (schemaMaps.has(key) || schemaLists.has(key)) position = { each: "schema" };
			else if (key === "items") {
				position = Array.isArray(isObject(node) ? node.items : undefined)
					? { each: "schema" }
					: "schema";
			} else if (schemaValues.has(key)) position = "schema";
			else return false;
		} else {
			const next: Position | undefined = positionSteps[position]?.[key];
			if (next === undefined || !Object.hasOwn(positionSteps[position] ?? {}, key)) return false;
			position = next;
		}
		if (!isObject(node) && !Array.isArray(node)) return false;
		if (!Object.hasOwn(node, key)) return false;
		node = (node as Json)[key];
	}
	return position === "schema" && (isObject(node) || typeof node === "boolean");
}

export function report(ctx: Context, location: Location, code: ProblemCode, message: string): void {
	const pointer = segments(location);
	const key = `${code}\0${pointer.join("\0")}`;
	if (ctx.problemKeys.has(key)) return;
	ctx.problemKeys.add(key);
	ctx.problems.push({ pointer, code, message: `${message} (at ${formatPointer(pointer)})` });
}

export function resolvePointer(doc: unknown, pointer: readonly string[]): unknown {
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
export function resolveRefLoosely(doc: Json, ref: unknown, visited: string[] = []): unknown {
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

export function lastSegment(ref: string): string {
	const parts = (parsePointer(ref.slice(ref.indexOf("#"))) ?? []).filter(Boolean);
	return parts.at(-1) ?? "";
}
