# inspex

Import an OpenAPI document in TypeScript and get its types, with no generation step. `inspex` is a [TypeScript 7.1 content mapper](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers): the compiler hands it `acme.openapi.jsonc` and gets back `paths`, `components` and `operations` in the shapes [openapi-typescript](https://openapi-ts.dev) emits, so `openapi-fetch` and similar tools work unchanged.

> [!WARNING]
> Content mappers need TypeScript 7.1, which is in beta. Where the mapper does not run, the import does not resolve: see [Where the mapper does not run](#where-the-mapper-does-not-run).

## Requirements

- TypeScript 7.1 or later (today `typescript@beta`, 7.1.0-beta), run with `--runExternalCode`.
- Node.js 22 or later on `PATH`: the compiler starts the mapper with `node`.

`inspex` has no dependencies; TypeScript is its only peer dependency.

## Install

```sh
npm install --save-dev inspex typescript@beta
```

Register the mapper in `tsconfig.json` (at the top level, not in `compilerOptions`):

```jsonc
{
	"compilerOptions": {
		// ...
	},
	"contentMappers": [{ "package": "inspex", "extensions": [".openapi.jsonc"] }],
}
```

and pass `--runExternalCode` to every `tsc` call; the flag cannot be set in `tsconfig.json`:

```json
{ "scripts": { "check:types": "tsc --noEmit --runExternalCode" } }
```

### Options

`options` in the `contentMappers` entry:

| name               | type                                        | default | meaning                                                                                                                                               |
| ------------------ | ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`         | `{ "module": string, "interface": string }` | none    | Also adds every spec to an interface of another module, under the spec's name ([register](#register)).                                                |
| `readWriteMarkers` | `boolean`                                   | `false` | Marks `readOnly` and `writeOnly` properties as openapi-typescript's option of the same name does ([readOnly and writeOnly](#readonly-and-writeonly)). |

Anything else in `options`, or a value of the wrong type, is an error at its place in `tsconfig.json`.

## What you can import

Save the spec as `<name>.openapi.jsonc` and import its types:

```ts
import type { components, operations, paths } from "./acme.openapi.jsonc";

type User = components["schemas"]["User"];
type GetUserResponse = operations["getUser"]["responses"][200]["content"]["application/json"];

const user: User = { id: "1", nmae: "Ada" };
//                            ~~~~ Object literal may only specify known properties, and 'nmae' does not exist in type '{ id: string; name: string; }'.
```

With [openapi-fetch](https://openapi-ts.dev/openapi-fetch/):

```ts
import createClient from "openapi-fetch";

import type { paths } from "./acme.openapi.jsonc";

const client = createClient<paths>({ baseUrl: "https://api.acme.test" });
const { data } = await client.GET("/users/{id}", { params: { path: { id: "42" } } });
//      ^? { id: string; name: string } | undefined
await client.GET("/userz/{id}");
//               ~~~~~~~~~~~~~ not assignable to '"/users/{id}"'
```

Only types exist: import with `import type`. A value import compiles but fails at run time, because the module has no JavaScript.

Change the spec and every file that no longer matches it fails the type check.

### readOnly and writeOnly

By default inspex emits what openapi-typescript emits by default: a `readOnly` property is a `readonly` property, still required in request bodies, and a `writeOnly` property is still present in responses.

With `"readWriteMarkers": true`, `readOnly` properties are typed `$Read<T>` and `writeOnly` properties `$Write<T>`, exactly as openapi-typescript's `readWriteMarkers` option does, and the module also exports `$Read`, `$Write`, `Readable` and `Writable`. openapi-fetch 0.17 and later understand the markers: request bodies leave `readOnly` properties out, responses leave `writeOnly` properties out. If you use the types directly, unwrap them:

```ts
import type { components, Readable, Writable } from "./acme.openapi.jsonc";

type User = Readable<components["schemas"]["User"]>; // as received
type NewUser = Writable<components["schemas"]["User"]>; // as sent
```

## register

`register` lets a package receive the types without knowing inspex. With

```jsonc
"options": { "register": { "module": "@acme/client", "interface": "Specs" } }
```

each spec's module also augments `interface Specs` of `@acme/client` with one property, named after the spec, whose value is `{ paths: paths; components: components; operations: operations }`. A spec under `include` is in the program even if nothing imports it, so the consumer's code needs no import:

```ts
// @acme/client
export interface Specs {}
type Operations<Name extends keyof Specs> = Specs[Name] extends { operations: infer O } ? O : never;
export declare function call<Name extends keyof Specs>(
	spec: Name,
	id: keyof Operations<Name>,
): void;
```

```ts
// your code, with billing.openapi.jsonc under include
call("billing", "getInvoice");
call("billing", "getInvoce"); // error: not an operationId of billing.openapi.jsonc
```

Two files with the same name (in different folders) cannot register in one program: one of them is an error that names both paths. Without `register`, nothing is augmented.

## File names and formats

The file name picks the format, and the name before the format's suffix is the spec's name:

| file name            | format                    | spec name |
| -------------------- | ------------------------- | --------- |
| `acme.openapi.jsonc` | OpenAPI 3.0 or 3.1, JSONC | `acme`    |

JSONC is JSON with comments and trailing commas. TypeScript refuses to hand extensions ending in `.json` to a mapper (`.openapi.json` included), hence `.jsonc`; editors highlight it as JSON with comments. YAML is not supported yet, and any other extension registered for inspex is reported as an error.

## Diagnostics

A problem in a spec is an error at its place in the spec, with the JSON pointer of the offending value. The rest of the spec keeps its types, and the program's other type errors are still reported:

```
src/acme.openapi.jsonc(12,91): error inspex4: Cannot resolve $ref "#/components/schemas/Missing"; typed as unknown (at #/paths/~1c/get/responses/200/content/application~1json/schema/$ref)
src/app.ts(10,14): error TS2322: Type 'string' is not assignable to type 'number'.
```

| code       | problem                                                                                                                                                            | types                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `inspex1`  | invalid JSONC (with the line and column)                                                                                                                           | none: the module exports nothing                                                            |
| `inspex2`  | not an OpenAPI 3.0 or 3.1 document (Swagger 2.0, another version), or a file name that is not `<name>.openapi.jsonc`                                               | none                                                                                        |
| `inspex3`  | duplicate `operationId`                                                                                                                                            | the first keeps the id; later ones are typed inline in `paths` and left out of `operations` |
| `inspex4`  | a `$ref` that does not resolve                                                                                                                                     | `unknown` there                                                                             |
| `inspex5`  | a `$ref` to another file or a URL, to something that is not a schema in a schema, or to a component of the wrong kind                                              | `unknown` there                                                                             |
| `inspex6`  | a value of the wrong kind (a schema that is not an object, ...)                                                                                                    | `unknown` there                                                                             |
| `inspex7`  | two specs with the same name registered in one program                                                                                                             | the second is not registered                                                                |
| `inspex9`  | a malformed option (reported in `tsconfig.json`)                                                                                                                   |                                                                                             |
| `inspex10` | a `$ref` cycle with no object or array in between (`A` is `B`, `B` is `A`; or `C` is `C \| string`), or a recursive schema reached by a `$ref` into another schema | `unknown` for each component on the cycle, or at that `$ref`                                |

How: the mapper protocol's own diagnostics are treated as syntax errors, and TypeScript then hides every semantic error in the program. inspex reports problems as unused diagnostic directives of a generated companion file instead, which TypeScript reports alongside the program's other errors (verified on 7.1.0-beta and 7.1.0-dev.20261116.1).

## Cache

Generated declarations are cached in `node_modules/.cache/inspex` next to `tsconfig.json`, keyed by a SHA-256 of the file's content, the mapper's own code and the options. Content, not size and modification time: the editor sends unsaved content, and a same-size edit within the file system's time resolution would otherwise be served stale. An entry is used only if it parses, carries its own key and matches its checksum, so a stale, foreign or damaged entry is regenerated. The cache protects against stale and damaged entries, not against someone who can write to it: they can rewrite the checksum too. Symbolic links are never followed: if the cache directory or an entry is one, the cache is not used. The cache can never fail or change a transform: an entry that cannot be read, checked or parsed is regenerated, and a write that fails is ignored. The directory is safe to delete; `node_modules` is usually git-ignored already.

## Where the mapper does not run

There is no fallback: where the mapper does not run, the import does not resolve.

- TypeScript 7.1 without `--runExternalCode`:
  ```
  src/app.ts(1,52): error TS2307: Cannot find module './acme.openapi.jsonc' or its corresponding type declarations.
  tsconfig.json(4,2): error TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.
  ```
- TypeScript 7.0 ignores `contentMappers`:
  ```
  src/app.ts(1,52): error TS2307: Cannot find module './acme.openapi.jsonc' or its corresponding type declarations.
  ```
  and refuses the flag: `error TS5023: Unknown compiler option '--runExternalCode'.`
- Editors: VS Code passes `--runExternalCode` to TypeScript's language server only in trusted workspaces, and the mapper package must be inside the opened folder (from the TypeScript pull request and an earlier spike; not verified for this package).
- Other type-aware tools (type-aware linters such as oxlint's tsgolint, older TypeScript) see the import as unresolved until they run content mappers.

## Differences from openapi-typescript

The types equal openapi-typescript 7's default output, except where that output is wrong or does not compile. There inspex emits the correct type, or `unknown` and an error. Each difference has a fixture in `tests/fixtures/differential` and is checked against openapi-typescript 7.13 in `tests/differential.test.ts`:

- `{ "type": "object" }` without properties is `Record<string, unknown>`; openapi-typescript's `Record<string, never>` makes every read `never` (it offers this as `emptyObjectsUnknown`).
- A spec without operationIds has an empty `operations` interface; openapi-typescript's `Record<string, never>` makes `operations["anything"]` compile as `never`.
- A component that is only a `$ref` to another component (`"Alias": { "$ref": "#/components/parameters/P" }`) has its target's type; openapi-typescript types the alias object itself (a parameter becomes `string`, a response loses its content).
- A `$ref` into a schema (`#/components/schemas/A/properties/nested/properties/id`) is the schema it reaches; openapi-typescript indexes along the pointer, which does not compile through an optional property or `items`.
- A schema that refers to itself through an array (a JSON value type) is a type alias named `$schema_<Name>`, which shows in hovers and errors; openapi-typescript's output is circular (`TS2502`) and silently `any` when not checked.
- A `$ref` cycle with no object or array in between is `unknown` and an error; openapi-typescript rejects the document.
- operationIds are kept as they are; openapi-typescript replaces `#` with `/`, so `a#b` and `a/b` become one key declared twice.
- A `$ref` percent-encoded in the URI fragment (`#/components/schemas/A%7E1B` for `A/B`) is decoded before `~1` and `~0` (RFC 6901); openapi-typescript cannot resolve it.
- `required` beside an `allOf` `$ref` makes a property required only when the type emitted for the target has it; openapi-typescript also does so when that type is nullable, a union without the property or a literal, and emits `WithRequired<T, "x">` that does not compile.
- A schema with its own shape beside an `allOf` (or `anyOf`, `oneOf`) `$ref` back to itself is typed by that shape (`A = { x } & A` is `{ x }`); openapi-typescript's self-intersection does not compile.
- Schemas that include each other through `allOf`, `anyOf` or `oneOf` (`A = { x } & B`, `B = { y } & A`) are `unknown` and an error (`inspex10`); openapi-typescript's output for them is circular (`TS2502`).
- Names that are also `Object.prototype` members (`__proto__`, `constructor`) are ordinary names: a discriminator named `__proto__` is kept, and `required: ["constructor"]` does not invent a property.
- A broken part of a spec (a `$ref` that does not resolve, a duplicate operationId) is `unknown` or left out, with an error; openapi-typescript rejects the whole document.

## Limits

What the generator types, and how:

| keyword or case                                                                                                                 | type                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `type` (also the 3.1 array form), `enum`, `const`, 3.0 `nullable`                                                               | as openapi-typescript; `{ "const": null }` is `unknown`, as openapi-typescript                                |
| `properties`, `required`, `additionalProperties`, `patternProperties`                                                           | as openapi-typescript (no `additionalProperties`: a closed object)                                            |
| `items`, `prefixItems` (and 3.0 array `items`)                                                                                  | arrays and tuples, as openapi-typescript                                                                      |
| `allOf`, `oneOf`, `anyOf`, `discriminator` (with and without `mapping`)                                                         | as openapi-typescript                                                                                         |
| `not`, `if`/`then`/`else`, `dependentSchemas`, `unevaluatedProperties`, `minItems` and other constraints                        | ignored, as openapi-typescript does                                                                           |
| `format`                                                                                                                        | no effect on the type; `format: binary` is `string`, as openapi-typescript (not `Blob` or `File`)             |
| `readOnly` / `writeOnly`                                                                                                        | without `readWriteMarkers`, a required `readOnly` property is required in request bodies too                  |
| `default`                                                                                                                       | makes a property required outside parameters and request bodies, as openapi-typescript                        |
| `description`, `title`, `summary`, `deprecated`, `format`, `default`                                                            | JSDoc (examples are left out)                                                                                 |
| a 3.1 `$ref` with sibling keywords (`required`, `properties`, ...)                                                              | the referenced type; the siblings are ignored, as openapi-typescript does                                     |
| `$ref` to another file or URL                                                                                                   | `unknown` and an error                                                                                        |
| a recursive schema reached by a `$ref` into another schema (`#/components/schemas/A/$defs/Node`, where `Node` refers to itself) | `unknown` and an error (`inspex10`): inspex cannot name it; move it to `components.schemas` to give it a type |
| webhooks                                                                                                                        | their operations are in `operations`; `webhooks` itself is not exported                                       |
| YAML specs, OpenAPI 3.2, Swagger 2.0                                                                                            | not supported                                                                                                 |

The types match openapi-typescript 7.13 (with `emptyObjectsUnknown: true`, with and without `readWriteMarkers`) on this repository's fixtures, the Stripe spec (612 operations) and the Cloudflare spec (3,778 operations), compared by the TypeScript compiler, apart from the differences above: on Stripe none applies; on Cloudflare, 4 schemas get a recursion alias and 1,410 objects without properties are `Record<string, unknown>`. inspex's declarations for all of them compile without errors.

Not tested:

- editors and language servers (no editor was run against this package);
- platforms beyond these: Linux with Node.js 22.0.0, 22.23.2 and 26.13.0 (locally), and GitHub's `ubuntu-latest`, `macos-latest` and `windows-latest` runners with Node.js 26.13.0 (CI runs the end-to-end tests on all three);
- `tsc --build`, `--incremental` and `--watch`, and projects that emit declarations (an earlier spike saw `TS18125` with `declaration: true`).

## Cost

`tsc --noEmit --runExternalCode` on TypeScript 7.1.0-beta, median of 5 runs, a program that imports `paths`, `components` and `operations`; cold = cache emptied before each run. Measured on 2026-11-16 on an AMD Ryzen 7 6800H (16 threads, 27 GB, Linux 6.18, Node.js 26.13.0, load about 2). The large specs are not part of this repository.

| spec                                 | cold   | warm   | same declarations as a `.d.ts` on disk | peak memory, cold / warm (process tree) | mapper process peak | declarations |
| ------------------------------------ | ------ | ------ | -------------------------------------- | --------------------------------------- | ------------------- | ------------ |
| small (7 operations, 3 KB)           | 0.14 s | 0.14 s | 0.10 s                                 | 61 / 61 MB                              | 62 MB               | 3.5 KB       |
| Stripe (612 operations, 8.3 MB)      | 0.53 s | 0.32 s | 0.14 s                                 | 224 / 147 MB                            | 201 MB              | 3.3 MB       |
| Cloudflare (3,778 operations, 28 MB) | 1.52 s | 0.79 s | 0.32 s                                 | 509 / 351 MB                            | 448 MB              | 9.6 MB       |

The compiler sends the whole spec to the mapper on every run, so a warm run still costs more than a `.d.ts` on disk.

## Related

- [openapi-typescript](https://openapi-ts.dev): types in these shapes from a generation step; inspex's output is compared with it.
- [Kubb's `openapi-import`](https://github.com/kubb-labs/openapi-import) is also a content mapper for OpenAPI. It exports named types per operation and schema, and its output can come from Kubb plugins, where inspex exports openapi-typescript's `paths`, `components` and `operations` and caches across runs. An earlier spike measured version 0.0.12 without a cross-run cache: 6.2 s per run on the Stripe spec and 24.7 s on Cloudflare's.

## Development

Install [mise](https://mise.jdx.dev/getting-started.html), then:

```sh
mise trust && mise install
pnpm install
pnpm run check         # format and lint
pnpm run check:types   # type check
pnpm run test          # build dist/, then the tests
pnpm run build         # build dist/
```

The end-to-end tests run the compiler on the projects in `tests/fixtures`, with `dist/server.js` as their mapper; `pnpm exec vp test run <file>` needs a build first. `openapi-typescript` is a development dependency only, the oracle of `tests/differential.test.ts`; set `INSPEX_DIFFERENTIAL_SPECS` to compare more specs.

Record user-visible changes with `pnpm run changeset`. Merging to `main` opens a release pull request; merging that publishes to npm.

## License

MIT
