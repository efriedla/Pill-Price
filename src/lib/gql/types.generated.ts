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

export type DoseForm = {
  __typename: 'DoseForm';
  name: Scalars['String']['output'];
  rxcui: Scalars['ID']['output'];
};

export type DoseFormResult = Absent | DoseForm | Unavailable;

export type Drug = {
  __typename: 'Drug';
  alternatives: AlternativesResult;
  doseForm: DoseFormResult;
  ingredients: IngredientsResult;
  isGeneric: Scalars['Boolean']['output'];
  label: LabelResult;
  name: Scalars['String']['output'];
  packages: Array<Package>;
  price: PriceResult;
  priceHistory: PriceSeriesResult;
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

export type Ingredient = {
  __typename: 'Ingredient';
  name: Scalars['String']['output'];
  rxcui: Scalars['ID']['output'];
};

export type Ingredients = {
  __typename: 'Ingredients';
  ingredients: Array<Ingredient>;
};

export type IngredientsResult = Absent | Ingredients | Unavailable;

export type Label = {
  __typename: 'Label';
  chosenBy: LabelChoice;
  effectiveDate: Scalars['String']['output'];
  manufacturer: Scalars['String']['output'];
  productName: Scalars['String']['output'];
  sections: Array<LabelSection>;
  setId: Scalars['ID']['output'];
};

export type LabelChoice =
  | 'BRAND_VERSION'
  | 'ORIGINAL_PACKAGER'
  | 'OWN_LABEL'
  | 'REFERENCE_IN_RESULTS';

export type LabelResult = Absent | Label | Unavailable;

export type LabelSection = {
  __typename: 'LabelSection';
  kind: LabelSectionKind;
  paragraphs: Array<Scalars['String']['output']>;
};

export type LabelSectionKind =
  | 'ADVERSE_REACTIONS'
  | 'BOXED_WARNING'
  | 'CONTRAINDICATIONS'
  | 'DOSAGE_AND_ADMINISTRATION'
  | 'DRUG_INTERACTIONS'
  | 'INDICATIONS_AND_USAGE'
  | 'WARNINGS_AND_CAUTIONS';

export type Package = {
  __typename: 'Package';
  description: Scalars['String']['output'];
  ndc: Scalars['ID']['output'];
  price: PriceResult;
};

export type Price = {
  __typename: 'Price';
  asOf: Scalars['String']['output'];
  effectiveDate: Scalars['String']['output'];
  pricePerUnit: Scalars['String']['output'];
  unit: Scalars['String']['output'];
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

export type PriceResult = Absent | Price | Unavailable;

export type PriceSeries = {
  __typename: 'PriceSeries';
  coverage: Coverage;
  granularity: Granularity;
  points: Array<PricePoint>;
  range: PriceRange;
  unit: Scalars['String']['output'];
};

export type PriceSeriesResult = Absent | PriceSeries | Unavailable;

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
