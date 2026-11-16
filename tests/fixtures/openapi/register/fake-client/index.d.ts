// A made-up consumer package: it knows nothing about inspex, only its own `Specs` interface.
export interface Specs {}

type Operations<Name extends keyof Specs> = Specs[Name] extends { operations: infer O } ? O : never;

export declare function operationId<Name extends keyof Specs>(spec: Name, id: keyof Operations<Name>): void;
