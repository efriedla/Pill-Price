/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type DrugHeaderQueryVariables = Exact<{
  rxcui: string | number;
}>;


export type DrugHeaderQuery = { drug: { rxcui: string, name: string, tty: string, isGeneric: boolean, price: { pricePerUnit: string, unit: string, effectiveDate: string, asOf: string } | null } | null };


export const DrugHeaderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DrugHeader"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"rxcui"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"drug"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"rxcui"},"value":{"kind":"Variable","name":{"kind":"Name","value":"rxcui"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rxcui"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"tty"}},{"kind":"Field","name":{"kind":"Name","value":"isGeneric"}},{"kind":"Field","name":{"kind":"Name","value":"price"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pricePerUnit"}},{"kind":"Field","name":{"kind":"Name","value":"unit"}},{"kind":"Field","name":{"kind":"Name","value":"effectiveDate"}},{"kind":"Field","name":{"kind":"Name","value":"asOf"}}]}}]}}]}}]} as unknown as DocumentNode<DrugHeaderQuery, DrugHeaderQueryVariables>;