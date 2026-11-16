import { defineConfig } from "vite-plus";

const ignorePatterns = [".changeset/", "**/CHANGELOG.md", "**/tests/fixtures/"];

export default defineConfig({
	fmt: {
		useTabs: true,
		sortImports: true,
		sortPackageJson: false,
		ignorePatterns,
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
			reportUnusedDisableDirectives: "deny",
		},
		plugins: ["unicorn", "typescript", "oxc", "import", "promise", "node"],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		categories: {
			correctness: "error",
			suspicious: "error",
		},
		rules: {
			"eslint/no-underscore-dangle": "off",
			"unicorn/no-array-sort": "off",
			"unicorn/consistent-function-scoping": "off",
			"typescript/no-unsafe-type-assertion": "off",
			"typescript/no-base-to-string": "off",
			"typescript/consistent-return": "off",
			"promise/always-return": "off",
			"typescript/no-unnecessary-type-parameters": "off",

			"import/no-cycle": "error",
			"typescript/no-import-type-side-effects": "error",
			"oxc/bad-bitwise-operator": "error",
			"oxc/no-accumulating-spread": "error",

			"typescript/no-misused-promises": "error",
			"typescript/switch-exhaustiveness-check": [
				"error",
				{ considerDefaultExhaustiveForUnions: true },
			],

			"vite-plus/prefer-vite-plus-imports": "error",
		},
		ignorePatterns,
		overrides: [
			{
				files: ["**/*.test.ts", "**/*.test-d.ts"],
				rules: {
					"eslint/no-new": "off",
					"eslint/no-shadow": "off",
					"typescript/unbound-method": "off",
				},
			},
		],
	},
	pack: {
		// The package's only file is the content mapper process; there is nothing to import.
		entry: ["src/server.ts"],
		dts: false,
		fixedExtension: false,
		publint: "ci-only",
		// Nothing is importable (the package is a program the compiler starts), so attw has no types to resolve.
		attw: false,
	},
	test: {
		// A file opts in with a `@module-tag` comment; CI runs the tagged files on that host.
		tags: [
			{ name: "windows", description: "Also runs in the Windows CI job" },
			{ name: "macos", description: "Also runs in the macOS CI job" },
		],
	},
});
