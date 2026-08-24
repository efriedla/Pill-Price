import {
  buildSchema,
  GraphQLScalarType,
  isObjectType,
  isScalarType,
  parse,
  specifiedScalarTypes,
  validateSchema,
} from "graphql";
import { describe, expect, it } from "vitest";

import * as schemaModule from "@/server/schema";

/**
 * The schema is hand-written SDL inside a template literal, so nothing in the
 * normal toolchain reads it: `tsc` sees an opaque string and ESLint sees a
 * comment. A malformed type or a misspelled field stays invisible until a
 * resolver actually runs.
 *
 * These assertions are deliberately not a restatement of the schema — that
 * would rot on every field added. They check the three failure modes that have
 * actually bitten this file:
 *
 *   1. SDL that does not parse (inline anonymous types).
 *   2. A custom `scalar` declared with no serializer, which silently accepts
 *      any value at runtime rather than validating it.
 *   3. A resolver whose key does not match any field in the SDL — a typo that
 *      leaves the field permanently null and raises no error anywhere.
 */

const { typeDefs } = schemaModule;
const resolvers = (schemaModule as Record<string, unknown>).resolvers as
  | Record<string, Record<string, unknown>>
  | undefined;

const builtInScalars = new Set(specifiedScalarTypes.map((s) => s.name));

describe("GraphQL schema document", () => {
  it("parses as valid SDL", () => {
    expect(() => parse(typeDefs)).not.toThrow();
  });

  it("builds a schema with no validation errors", () => {
    const errors = validateSchema(buildSchema(typeDefs));
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("defines a Query type", () => {
    expect(buildSchema(typeDefs).getQueryType()).toBeDefined();
  });
});

describe("custom scalars", () => {
  /**
   * `buildSchema` gives every undeclared custom scalar a passthrough
   * serializer, so `scalar UUID` with no implementation type-checks in the SDL
   * and then accepts the string "not-a-uuid" at runtime. If the schema claims a
   * value is constrained, something has to enforce it.
   */
  it("every declared scalar is a built-in or has a real serializer", () => {
    const schema = buildSchema(typeDefs);
    const custom = Object.values(schema.getTypeMap())
      .filter(isScalarType)
      .filter((t) => !t.name.startsWith("__") && !builtInScalars.has(t.name));

    const unimplemented = custom
      .filter((t) => !(resolvers?.[t.name] instanceof GraphQLScalarType))
      .map((t) => t.name);

    expect(unimplemented).toEqual([]);
  });
});

describe("resolvers", () => {
  it.runIf(resolvers)("only define fields that exist in the SDL", () => {
    const schema = buildSchema(typeDefs);

    const unknown: string[] = [];
    for (const [typeName, fields] of Object.entries(resolvers ?? {})) {
      const type = schema.getType(typeName);

      if (!type) {
        unknown.push(typeName);
        continue;
      }
      if (!isObjectType(type)) continue;

      const known = type.getFields();
      for (const field of Object.keys(fields)) {
        if (!(field in known)) unknown.push(`${typeName}.${field}`);
      }
    }

    expect(unknown).toEqual([]);
  });
});
