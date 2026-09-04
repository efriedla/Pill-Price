export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Absent = {
  __typename: 'Absent';
  reason: Scalars['String']['output'];
  source: Scalars['String']['output'];
};

export type AlternativeKind =
  | 'ALL'
  | 'BRAND'
  | 'GENERIC';

export type Alternatives = {
  __typename: 'Alternatives';
  drugs: Array<Drug>;
};

export type AlternativesResult = Absent | Alternatives | Unavailable;

export type Coverage = {
  __typename: 'Coverage';
  pricedPackages: Scalars['Int']['output'];
  totalPackages: Scalars['Int']['output'];
};

export type Drug = {
  __typename: 'Drug';
  alternatives: AlternativesResult;
  isGeneric: Scalars['Boolean']['output'];
  label: LabelResult;
  name: Scalars['String']['output'];
  packages: Array<Package>;
  price?: Maybe<Price>;
  priceHistory: PriceSeries;
  rxcui: Scalars['ID']['output'];
  tty: Scalars['String']['output'];
};


export type DrugAlternativesArgs = {
  kind?: InputMaybe<AlternativeKind>;
};


export type DrugPriceHistoryArgs = {
  range?: PriceRange;
};

export type Granularity =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'WEEKLY';

export type Label = {
  __typename: 'Label';
  openFDALabel?: Maybe<Scalars['String']['output']>;
};

export type LabelResult = Absent | Label | Unavailable;

export type Package = {
  __typename: 'Package';
  description: Scalars['String']['output'];
  ndc: Scalars['ID']['output'];
  price?: Maybe<Price>;
};

export type Price = {
  __typename: 'Price';
  asOf: Scalars['String']['output'];
  effectiveDate: Scalars['String']['output'];
  pricePerUnit: Scalars['String']['output'];
};

export type PricePoint = {
  __typename: 'PricePoint';
  observations: Scalars['Int']['output'];
  perUnit?: Maybe<Scalars['String']['output']>;
  periodEnd: Scalars['String']['output'];
  periodStart: Scalars['String']['output'];
};

export type PriceRange =
  | 'CURRENT'
  | 'FIVE_YEAR'
  | 'MAX'
  | 'QUARTER'
  | 'YEAR';

export type PriceSeries = {
  __typename: 'PriceSeries';
  coverage: Coverage;
  granularity: Granularity;
  points: Array<PricePoint>;
  range: PriceRange;
  unit: Scalars['String']['output'];
};

export type Query = {
  __typename: 'Query';
  drug?: Maybe<Drug>;
  search: Array<Drug>;
};


export type QueryDrugArgs = {
  rxcui: Scalars['ID']['input'];
};


export type QuerySearchArgs = {
  term: Scalars['String']['input'];
};

export type Unavailable = {
  __typename: 'Unavailable';
  reason: Scalars['String']['output'];
  retryable: Scalars['Boolean']['output'];
  source: Scalars['String']['output'];
};
