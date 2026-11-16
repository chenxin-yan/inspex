// Path items and operations: parameters, request bodies, responses and headers.

import { ProblemCode } from "../../problems.ts";
import {
	type Context,
	isObject,
	type Json,
	type Location,
	methods,
	parameterLocations,
} from "./context.ts";
import {
	at,
	escapePointer,
	formatPointer,
	nodeKey,
	report,
	resolveRefLoosely,
	segments,
} from "./refs.ts";
import { refType, schemaType } from "./schema.ts";
import {
	atom,
	jsDoc,
	NEVER,
	objectType,
	propertyKey,
	STRING,
	type Type,
	UNKNOWN,
} from "./type-text.ts";

interface LocatedParameter {
	parameter: unknown;
	location: Location;
}

export function pathItem(ctx: Context, item: Json, path: string, location: Location): Type {
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

export function parameterType(
	ctx: Context,
	parameter: Json,
	path: string,
	location: Location,
): Type {
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

export function requestBodyType(ctx: Context, body: Json, path: string, location: Location): Type {
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

export function responseType(ctx: Context, response: Json, path: string, location: Location): Type {
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

export function headerType(ctx: Context, header: Json, path: string, location: Location): Type {
	if (header.schema) return schemaType(ctx, header.schema, path, at(location, "schema"));
	if (header.content) {
		const members = contentMembers(ctx, header.content, path, location, true);
		return objectType(members);
	}
	return UNKNOWN;
}
