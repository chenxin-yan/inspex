# inspex reference

What inspex reports, where it differs from openapi-typescript, what each keyword becomes, and what it costs. The [README](https://github.com/chenxin-yan/inspex#readme) covers installing and using it.

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

## What each keyword becomes

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
- platforms beyond these: Linux with Node.js 26.13.0 (locally), and GitHub's `ubuntu-latest`, `macos-latest` and `windows-latest` runners with Node.js 26.13.0 (CI runs the end-to-end tests on all three);
- `tsc --build`, `--incremental` and `--watch`, and projects that emit declarations (an earlier spike saw `TS18125` with `declaration: true`).

## Cost

`tsc --noEmit --runExternalCode` on TypeScript 7.1.0-beta, median of 5 runs, a program that imports `paths`, `components` and `operations`; cold = cache emptied before each run. Measured on 2026-11-16 on an AMD Ryzen 7 6800H (16 threads, 27 GB, Linux 6.18, Node.js 26.13.0, load about 2). The large specs are not part of this repository.

| spec                                 | cold   | warm   | same declarations as a `.d.ts` on disk | peak memory, cold / warm (process tree) | mapper process peak | declarations |
| ------------------------------------ | ------ | ------ | -------------------------------------- | --------------------------------------- | ------------------- | ------------ |
| small (7 operations, 3 KB)           | 0.14 s | 0.14 s | 0.10 s                                 | 61 / 61 MB                              | 62 MB               | 3.5 KB       |
| Stripe (612 operations, 8.3 MB)      | 0.53 s | 0.32 s | 0.14 s                                 | 224 / 147 MB                            | 201 MB              | 3.3 MB       |
| Cloudflare (3,778 operations, 28 MB) | 1.52 s | 0.79 s | 0.32 s                                 | 509 / 351 MB                            | 448 MB              | 9.6 MB       |

The compiler sends the whole spec to the mapper on every run, so a warm run still costs more than a `.d.ts` on disk.
