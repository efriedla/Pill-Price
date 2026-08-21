import "server-only";

/**
 * The GraphQL schema is written as a document first, before any resolver —
 * see the W2 operating rule. This is the W1 placeholder so the layer exists
 * and its boundaries are enforced from the start.
 */
export const typeDefs = /* GraphQL */ `
  type Query {
    _placeholder: Boolean
  }
`;
