import createClient from "openapi-fetch";

import type { paths } from "./acme.openapi.jsonc";

const client = createClient<paths>({ baseUrl: "https://api.acme.test" });

const { data, error } = await client.GET("/users/{id}", { params: { path: { id: "42" }, query: { expand: true } } });
export const name: string | undefined = data?.name;
export const message: string | undefined = error?.message;

// Errors the test expects, one per line:
await client.GET("/userz/{id}", { params: { path: { id: "42" } } });
await client.GET("/users/{id}", { params: { path: {} } });
// Without readWriteMarkers, a readOnly property is required in a request body (as in openapi-typescript).
await client.POST("/users", { body: { name: "Ada", password: "pw" } });
