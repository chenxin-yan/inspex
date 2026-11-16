import { defineConfig } from "vite-plus";

const ignorePatterns = [".changeset/", "**/CHANGELOG.md"];

export default defineConfig({
	fmt: {
		useTabs: true,
		sortImports: true,
		sortPackageJson: false,
		ignorePatterns: [...ignorePatterns, "**/tests/fixtures/"],
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
		fixedExtension: false,
		publint: "ci-only",
		attw: {
			enabled: "ci-only",
			profile: "esm-only",
			level: "error",
		},
	},
	test: {
		// A file opts in with a `@module-tag` comment; CI runs the tagged files on that host.
		tags: [
			{ name: "windows", description: "Also runs in the Windows CI job" },
			{ name: "macos", description: "Also runs in the macOS CI job" },
		],
	},
});
