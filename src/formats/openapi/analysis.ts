// Passes before emission: $ref cycles and recursion aliases, and discriminator patching.

import { ProblemCode } from "../../problems.ts";
import {
	type ComponentKind,
	componentKinds,
	type Context,
	type Discriminator,
	isObject,
	type Json,
} from "./context.ts";
import {
	at,
	componentOf,
	escapePointer,
	nodeKey,
	parsePointer,
	reachesSchema,
	report,
	resolvePointer,
	resolveRefLoosely,
} from "./refs.ts";

// TypeScript resolves union and intersection members, array elements and type alias targets eagerly, and
// object members lazily. So components that refer to each other only through `$ref`s, unions and
// intersections (`A: B; B: A`, or `C: C | string`) have no type (TS2502, TS2456): they are reported and
// typed `unknown`. Through an array, recursion has a type, but not as an indexed access
// (`X: components["schemas"]["X"][]` is TS2502): those schemas get a type alias, which may refer to itself
// there, and references to them use it.
export function analyzeRefCycles(ctx: Context): void {
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
	const schemas = isObject(components.schemas) ? components.schemas : {};
	// A = { x } & A is just { x }: a shaped schema's composition $refs to itself are left out. A cycle
	// through other components stays one: leaving those out would lose their members.
	for (const cycle of cycles(direct)) {
		for (const node of cycle) {
			const { kind, name } = names.get(node) as { kind: ComponentKind; name: string };
			const schema = schemas[name];
			if (kind !== "schemas" || !isObject(schema) || !hasOwnShape(schema)) continue;
			const effective = { ...schema };
			for (const key of ["allOf", "anyOf", "oneOf"]) {
				if (!Array.isArray(schema[key])) continue;
				const kept = (schema[key] as unknown[]).filter((member) => {
					const target = isObject(member) ? componentOf(parsePointer(member.$ref)) : undefined;
					return !(target?.kind === "schemas" && target.name === name);
				});
				if (kept.length) effective[key] = kept;
				else delete effective[key];
			}
			ctx.effectiveSchemas.set(name, effective);
			const directRefs = new Set<string>();
			schemaRefs(ctx.doc, effective, false, directRefs, new Set());
			direct.set(node, directRefs);
			const eagerRefs = new Set<string>();
			schemaRefs(ctx.doc, effective, true, eagerRefs, new Set());
			eager.set(node, eagerRefs);
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
				`${members.length === 1 ? "This component includes itself" : `These components include each other (${members.join(", ")})`} through $ref, allOf, anyOf or oneOf with no object or array in between, which TypeScript cannot express; typed as unknown`,
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

/** Whether a schema has a type of its own beside its composition keywords. */
function hasOwnShape(schema: Json): boolean {
	return (
		schema.type !== undefined ||
		(isObject(schema.properties) && Object.keys(schema.properties).length > 0) ||
		!!schema.additionalProperties ||
		isObject(schema.patternProperties)
	);
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
export function scanDiscriminators(ctx: Context): void {
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
