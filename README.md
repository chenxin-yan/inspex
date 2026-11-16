# inspex

Import an OpenAPI document in TypeScript and get its types, with no generation step. `inspex` is a [TypeScript 7.1 content mapper](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers): the compiler hands it `acme.openapi.jsonc` and gets back `paths`, `components` and `operations` in the shapes [openapi-typescript](https://openapi-ts.dev) emits, so `openapi-fetch` and similar tools work unchanged.

> [!WARNING]
> Content mappers need TypeScript 7.1, which is in beta. Where the mapper does not run, the import does not resolve: see [Limits](#limits).

## Requirements

- TypeScript 7.1 or later (today `typescript@beta`, 7.1.0-beta), run with `--runExternalCode`.
- Node.js 26 or later on `PATH`: the compiler starts the mapper with `node`.

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

## Cache

Generated declarations are cached in `node_modules/.cache/inspex` next to `tsconfig.json`, keyed by the spec's content, inspex's own code and the options. Delete the directory to clear it; the cache can never fail or change a transform ([how](https://github.com/chenxin-yan/inspex/blob/main/docs/reference.md#cache)).

## Limits

- There is no fallback: where the mapper does not run, the import does not resolve. That is TypeScript 7.0 and older, 7.1 without `--runExternalCode`, editors in untrusted workspaces, and type-aware linters such as oxlint's tsgolint until they run content mappers.
- One file per spec: a `$ref` to another file or a URL is `unknown` and an error. YAML, OpenAPI 3.2 and Swagger 2.0 are not supported.
- The types equal openapi-typescript's, except where its output is wrong or does not compile; there inspex emits the correct type, or `unknown` and an error at its place in the spec. A few constructs, such as a 3.1 `$ref` with sibling keywords, are ignored as openapi-typescript does.
- Editors, `tsc --build`, `--watch` and declaration emit are not tested yet.

The diagnostics, every difference from openapi-typescript, what each keyword becomes, and the measured cost are in the [reference](https://github.com/chenxin-yan/inspex/blob/main/docs/reference.md).

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
