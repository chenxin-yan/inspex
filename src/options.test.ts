import { expect, it } from "vite-plus/test";

import { parseOptions } from "./options.ts";

it("defaults without options", () => {
	expect(parseOptions(undefined)).toEqual({
		options: { readWriteMarkers: false },
		diagnostics: [],
	});
});

it("accepts register and readWriteMarkers", () => {
	expect(
		parseOptions({
			register: { module: "@acme/client", interface: "Specs" },
			readWriteMarkers: true,
		}),
	).toEqual({
		options: { register: { module: "@acme/client", interface: "Specs" }, readWriteMarkers: true },
		diagnostics: [],
	});
});

const malformed: [options: unknown, [path: string[], messageText: string]][] = [
	[[], [[], "inspex options must be an object."]],
	[
		{ registr: {} },
		[["registr"], "Unknown inspex option 'registr'. Known options: register, readWriteMarkers."],
	],
	[{ readWriteMarkers: 1 }, [["readWriteMarkers"], "'readWriteMarkers' must be true or false."]],
	[
		{ register: "Specs" },
		[["register"], `'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`],
	],
	[
		{ register: { module: "", interface: "Specs" } },
		[
			["register", "module"],
			`'register.module' must be a module name. 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
		],
	],
	[
		{ register: { module: "m" } },
		[
			["register"],
			`'register.interface' must be an interface name (an identifier). 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
		],
	],
	[
		{ register: { module: "m", interface: "Not-An-Identifier" } },
		[
			["register", "interface"],
			`'register.interface' must be an interface name (an identifier). 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
		],
	],
	...["class", "let", "any", "unknown", "undefined", "void"].map(
		(name): (typeof malformed)[number] => [
			{ register: { module: "m", interface: name } },
			[
				["register", "interface"],
				`'register.interface' must be an interface name (an identifier). 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
			],
		],
	),
	...["", " m", "m ", "a\nb"].map((name): (typeof malformed)[number] => [
		{ register: { module: name, interface: "I" } },
		[
			["register", "module"],
			`'register.module' must be a module name. 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
		],
	]),
	[
		{ register: { module: "m", interface: "I", extra: 1 } },
		[
			["register", "extra"],
			`Unknown property 'extra'. 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
		],
	],
];

it.each(malformed)(
	"reports %j at its path, and ignores the malformed option",
	(options, [path, messageText]) => {
		const { options: parsed, diagnostics } = parseOptions(options);
		expect(diagnostics).toEqual([{ path, messageText, code: 9 }]);
		expect(parsed.register).toBeUndefined();
		expect(parsed.readWriteMarkers).toBe(false);
	},
);
