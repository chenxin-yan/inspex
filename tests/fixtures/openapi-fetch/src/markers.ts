import createClient from "openapi-fetch";

import type { components, paths, Readable, Writable } from "./acme.openapi.jsonc";

const client = createClient<paths>({ baseUrl: "https://api.acme.test" });

// With readWriteMarkers, openapi-fetch leaves readOnly properties out of request bodies
// and writeOnly properties out of responses.
const { data } = await client.POST("/users", { body: { name: "Ada", password: "pw" } });
export const id: string | undefined = data?.id;
export const user: Readable<components["schemas"]["User"]> = { id: "1", name: "Ada" };
export const input: Writable<components["schemas"]["User"]> = { name: "Ada", password: "pw" };

// Errors the test expects, one per line:
await client.POST("/users", { body: { id: "1", name: "Ada", password: "pw" } });
export const secret = data?.password;
