// The state and shared types of one generation, and the OpenAPI constants every part uses.

import { ProblemCode } from "../../problems.ts";

export interface Problem {
	/** JSON pointer segments of the offending value. */
	pointer: string[];
	message: string;
	code: ProblemCode;
}

export interface GenerateOptions {
	/** Mirrors openapi-typescript's `readWriteMarkers`. */
	readWriteMarkers?: boolean;
}

export interface GenerateResult {
	/** Declarations; undefined when the document cannot be typed at all. */
	text: string | undefined;
	problems: Problem[];
}

export const methods = [
	"get",
	"put",
	"post",
	"delete",
	"options",
	"head",
	"patch",
	"trace",
] as const;
export const parameterLocations = ["query", "header", "path", "cookie"] as const;
export const componentKinds = [
	"schemas",
	"responses",
	"parameters",
	"requestBodies",
	"headers",
	"pathItems",
] as const;
export type ComponentKind = (typeof componentKinds)[number];

export type Json = Record<string, unknown>;
export function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON pointer of a value, built only when a problem needs it. */
export type Location = { readonly up: Location; readonly key: string } | undefined;
export interface Discriminator {
	propertyName: string;
	mapping?: Record<string, string>;
}

export interface Context {
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
	/**
	 * Component schemas with their own shape beside composition `$ref`s to themselves: those `$ref`s add
	 * nothing (A = {x} & A is just {x}) and are left out.
	 */
	effectiveSchemas: Map<string, Json>;
	/** Property keys of the type emitted for each component schema (see `emittedKeys`). */
	componentKeys: Map<string, Keys>;
}

/**
 * The property keys of the type `schemaType` emits for `schema`, mirroring its structure: "all" when the
 * type has a string index signature (any key is in `keyof`), and no keys where unsure, so a promotion is
 * left out rather than emitted where it would not compile.
 */
export type Keys = Set<string> | "all";
