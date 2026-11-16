import type { components, operations, paths } from "./acme.openapi.jsonc";

type User = components["schemas"]["User"];
type GetUser = operations["getUser"];

export const user: User = { id: "1", name: "Ada", settings: { theme: ["dark", 1, null] } };
export const id: GetUser["parameters"]["path"]["id"] = "1";
export const ok: paths["/users/{id}"]["get"]["responses"][200]["content"]["application/json"] = user;

// Errors the test expects, one per line:
export const wrongField: User = { id: "1", nmae: "Ada" };
export const notJson: User = { id: "1", name: "Ada", settings: () => 1 };
