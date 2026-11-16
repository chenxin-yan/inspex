// The README's plain-fetch example: the types alone, with no client.
import type { components, paths } from "./acme.openapi.jsonc";

type User = components["schemas"]["User"];
type GetUserResponse = paths["/users/{id}"]["get"]["responses"][200]["content"]["application/json"];

const res = await fetch("https://api.acme.test/users/42");
const user: User = await res.json();
export const same: GetUserResponse = user;
export const name: string = user.name;

// Errors the test expects, one per line:
export const typo = user.nmae;
