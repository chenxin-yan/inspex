// The `options` object of a `contentMappers` entry for inspex.

import { ProblemCode } from "../openapi.ts";
import type { OptionDiagnostic } from "./protocol.ts";

export interface MapperOptions {
	/** Augments `interface <interface>` of module `<module>` with one property per spec. */
	register?: { module: string; interface: string };
	readWriteMarkers: boolean;
}

const optionNames = ["register", "readWriteMarkers"];
const identifier = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;
// Names an interface cannot have (TS2427, or a syntax error), and strict-mode reserved words for safety.
const reservedNames = new Set(
	(
		"break case catch class const continue debugger default delete do else enum export extends false " +
		"finally for function if import in instanceof new null return super switch this throw true try " +
		"typeof var void while with implements interface let package private protected public static yield " +
		"await any unknown never object string number boolean symbol bigint undefined"
	).split(" "),
);

export function parseOptions(value: unknown): {
	options: MapperOptions;
	diagnostics: OptionDiagnostic[];
} {
	const options: MapperOptions = { readWriteMarkers: false };
	const diagnostics: OptionDiagnostic[] = [];
	const fail = (path: (string | number)[], messageText: string): void => {
		diagnostics.push({ path, messageText, code: ProblemCode.InvalidOption });
	};
	if (value === undefined) return { options, diagnostics };
	if (!isRecord(value)) {
		fail([], "inspex options must be an object.");
		return { options, diagnostics };
	}
	for (const key of Object.keys(value)) {
		if (!optionNames.includes(key)) {
			fail([key], `Unknown inspex option '${key}'. Known options: ${optionNames.join(", ")}.`);
		}
	}
	if ("readWriteMarkers" in value) {
		if (typeof value.readWriteMarkers === "boolean")
			options.readWriteMarkers = value.readWriteMarkers;
		else fail(["readWriteMarkers"], "'readWriteMarkers' must be true or false.");
	}
	if ("register" in value) {
		const register = value.register;
		const shape = `'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`;
		if (!isRecord(register)) {
			fail(["register"], shape);
		} else {
			const before = diagnostics.length;
			for (const key of Object.keys(register)) {
				if (key !== "module" && key !== "interface")
					fail(["register", key], `Unknown property '${key}'. ${shape}`);
			}
			// A module name to augment: not empty, no surrounding spaces, no control characters.
			if (
				typeof register.module !== "string" ||
				!register.module ||
				register.module.trim() !== register.module ||
				/[\p{Cc}]/u.test(register.module)
			) {
				fail(
					["register", ...("module" in register ? ["module"] : [])],
					`'register.module' must be a module name. ${shape}`,
				);
			}
			if (
				typeof register.interface !== "string" ||
				!identifier.test(register.interface) ||
				reservedNames.has(register.interface)
			) {
				fail(
					["register", ...("interface" in register ? ["interface"] : [])],
					`'register.interface' must be an interface name (an identifier). ${shape}`,
				);
			}
			if (diagnostics.length === before) {
				options.register = {
					module: register.module as string,
					interface: register.interface as string,
				};
			}
		}
	}
	return { options, diagnostics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
