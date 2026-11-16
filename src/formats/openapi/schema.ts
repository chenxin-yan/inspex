// Schema Objects and the $refs inside them, to types; and which property keys an emitted type has.

import { ProblemCode } from "../../problems.ts";
import {
	type ComponentKind,
	type Context,
	type Discriminator,
	isObject,
	type Json,
	type Keys,
	type Location,
} from "./context.ts";
import {
	at,
	componentOf,
	escapePointer,
	lastSegment,
	nodeKey,
	parsePointer,
	reachesSchema,
	report,
	resolvePointer,
	resolveRefLoosely,
} from "./refs.ts";
import {
	arrayOf,
	atom,
	BOOLEAN,
	intersection,
	jsDoc,
	literal,
	NEVER,
	NULL,
	NUMBER,
	objectType,
	primitiveTexts,
	propertyKey,
	STRING,
	type Type,
	union,
	UNKNOWN,
} from "./type-text.ts";

/** Where a `$ref` is: in a schema, an operation, or in place of a component of one kind. */
type RefPlace = "schema" | "operation" | Exclude<ComponentKind, "schemas">;

/** The referenced type, or `unknown` after reporting why it cannot be referenced. */
export function refType(ctx: Context, value: unknown, location: Location, place: RefPlace): Type {
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
				`$ref "${value}" points inside a schema to a schema that refers to itself; inspex cannot name it, so it is typed as unknown (move it to components.schemas to give it a type)`,
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

export function schemaType(ctx: Context, schema: unknown, path: string, location: Location): Type {
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
				// Upstream promotes by the target's `properties` alone; `WithRequired<T, K extends keyof T>`
				// then does not compile when the type emitted for T lacks K (nullable, a union, a literal).
				const emitted = emittedKeys(ctx, item, new Set());
				const keys = required.filter(
					(k): k is string =>
						typeof k === "string" &&
						Object.hasOwn(properties, k) &&
						!!properties[k] &&
						(emitted === "all" || emitted.has(k)),
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

const noKeys: Keys = new Set();

function emittedKeys(ctx: Context, schema: unknown, seen: Set<unknown>): Keys {
	if (!isObject(schema) || seen.has(schema)) return noKeys;
	seen.add(schema);
	try {
		if ("$ref" in schema) {
			const pointer = parsePointer(schema.$ref);
			const component = componentOf(pointer);
			if (component?.kind === "schemas") {
				const node = nodeKey("schemas", component.name);
				if (ctx.refCycles.has(node)) return noKeys;
				const cached = ctx.componentKeys.get(component.name);
				if (cached) return cached;
				const schemas = isObject(ctx.doc.components) ? ctx.doc.components.schemas : undefined;
				const target =
					ctx.effectiveSchemas.get(component.name) ??
					(isObject(schemas) && Object.hasOwn(schemas, component.name)
						? schemas[component.name]
						: undefined);
				const keys = emittedKeys(ctx, target, seen);
				ctx.componentKeys.set(component.name, keys);
				return keys;
			}
			if (pointer && !component && reachesSchema(ctx.doc, pointer)) {
				return emittedKeys(ctx, resolvePointer(ctx.doc, pointer), seen);
			}
			return noKeys;
		}
		if (schema.const !== null && schema.const !== undefined) return noKeys;
		if (
			Array.isArray(schema.enum) &&
			schema.type !== "object" &&
			!("properties" in schema) &&
			!("additionalProperties" in schema)
		) {
			return noKeys;
		}
		// An intersection has the keys of all its members; a union only those every member has.
		let keys: Keys | undefined = coreKeys(schema);
		if (Array.isArray(schema.allOf)) {
			for (const member of schema.allOf) {
				let memberKeys = emittedKeys(ctx, member, seen);
				const discriminator =
					(isObject(member) &&
						typeof member.$ref === "string" &&
						ctx.discriminators.get(member.$ref)) ||
					(isObject(member) && isObject(member.discriminator) ? member.discriminator : undefined);
				if (discriminator && memberKeys !== "all") {
					memberKeys = new Set([...memberKeys].filter((k) => k !== discriminator.propertyName));
				}
				keys = keys === undefined ? memberKeys : unionKeys(keys, memberKeys);
			}
		}
		const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : [];
		if (anyOf.length) {
			keys = [...(keys ? [keys] : []), ...anyOf.map((m) => emittedKeys(ctx, m, seen))].reduce(
				commonKeys,
			);
		}
		const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
		if (oneOf.length) {
			const common = oneOf.map((m) => emittedKeys(ctx, m, seen)).reduce(commonKeys);
			// All members without keys may be primitives, whose union with the rest has no keys either.
			keys = common !== "all" && !common.size ? noKeys : unionKeys(keys ?? noKeys, common);
		}
		if (keys === undefined) return "type" in schema ? "all" : noKeys;
		return schema.nullable ? noKeys : keys;
	} finally {
		seen.delete(schema);
	}
}

/** The keys of `schemaCore`'s type, or undefined where it emits none. */
function coreKeys(schema: Json): Keys | undefined {
	if (schema.type && schema.type !== "object") return noKeys;
	// `schemaCore` may also add a discriminator property, found by the schema's path; left out here, so a
	// promotion of that property alone is left out too (the discriminator's own patch makes it required).
	const keys = new Set<string>();
	const properties = isObject(schema.properties) ? Object.keys(schema.properties) : [];
	if (
		!(properties.length || schema.additionalProperties || schema.patternProperties || schema.$defs)
	) {
		return undefined;
	}
	if (schema.additionalProperties || isObject(schema.patternProperties)) return "all";
	for (const key of properties) keys.add(key);
	if (isObject(schema.$defs) && Object.keys(schema.$defs).length) keys.add("$defs");
	return keys;
}

function unionKeys(a: Keys, b: Keys): Keys {
	return a === "all" || b === "all" ? "all" : new Set([...a, ...b]);
}

function commonKeys(a: Keys, b: Keys): Keys {
	if (a === "all") return b;
	if (b === "all") return a;
	return new Set([...a].filter((k) => b.has(k)));
}
