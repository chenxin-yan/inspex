# inspex

Import a spec file in TypeScript and get its types, with no generation step.

`inspex` is a set of [TypeScript content mappers](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers). A content mapper tells the compiler how to read a file type it does not know, so the types live in the spec itself: change the spec and every file that no longer matches it fails the type check.

> [!WARNING]
> Nothing usable is published yet. The first mapper, for OpenAPI documents, is in development. Content mappers need TypeScript 7.1, which is in beta.

## Planned

```jsonc
// tsconfig.json
{
	"contentMappers": [{ "package": "inspex", "extensions": [".openapi.jsonc"] }],
}
```

```ts
import type { paths } from "./acme.openapi.jsonc";
```

## Development

Install [mise](https://mise.jdx.dev/getting-started.html), then:

```sh
mise trust && mise install
pnpm install
pnpm run check         # format and lint
pnpm run check:types   # type check
pnpm run test          # tests
pnpm run build         # build dist/
```

Record user-visible changes with `pnpm run changeset`. Merging to `main` opens a release pull request; merging that publishes to npm.

## License

MIT
