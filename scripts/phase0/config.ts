/**
 * Phase 0 test inputs (PROJECT_PLAN.md §0.2–0.3, proposal §12).
 * These are test inputs only, not claims about shared audiences or brand matches.
 */

export interface StageInput {
  id: string;
  label: string;
  artists: string[];
}

export const STAGES: StageInput[] = [
  { id: "stage-1", label: "Main Stage (Indie / Alt Rock)", artists: ["Arctic Monkeys", "Tame Impala", "The 1975"] },
  { id: "stage-2", label: "Dance Arena (Electronic / Dance)", artists: ["Calvin Harris", "David Guetta", "Disclosure"] },
  { id: "stage-3", label: "Block Party (Hip-hop / R&B)", artists: ["Kendrick Lamar", "Travis Scott", "SZA"] },
];

/** Candidate shortlist (K≈12) across sponsor categories. Category is organizer-provided metadata, not Qloo data. */
export interface BrandInput {
  name: string;
  category: string;
}

export const BRAND_SHORTLIST: BrandInput[] = [
  { name: "Red Bull", category: "energy_drink" },
  { name: "Monster Energy", category: "energy_drink" },
  { name: "Heineken", category: "beer" },
  { name: "Coca-Cola", category: "soft_drink" },
  { name: "Absolut", category: "spirits" },
  { name: "Nike", category: "apparel" },
  { name: "Adidas", category: "apparel" },
  { name: "Levi's", category: "apparel" },
  { name: "Converse", category: "footwear" },
  { name: "Ray-Ban", category: "eyewear" },
  { name: "Spotify", category: "streaming" },
  { name: "Samsung", category: "consumer_electronics" },
];

/** Types used for /search. /search types differ from /v2/insights filter.type; see docs/phase0 notes. */
export const SEARCH_TYPES = {
  artist: "urn:entity:artist",
  brand: "urn:entity:brand",
} as const;

/**
 * Parameters documented as supported for filter.type=urn:entity:brand
 * (Entity Type Parameter Guide, retrieved 2026-10-15). Qloo silently ignores anything else,
 * so every brand Insights request is pre-validated against this list.
 */
export const BRAND_INSIGHTS_ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  "filter.type",
  "bias.trends",
  "filter.exclude.entities",
  "operator.exclude.tags",
  "filter.exclude.tags",
  "filter.external.exists",
  "operator.filter.external.exists",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "filter.results.entities",
  "filter.results.entities.query",
  "filter.tags",
  "operator.filter.tags",
  "signal.demographics.age",
  "signal.demographics.audiences",
  "signal.demographics.audiences.weight",
  "signal.interests.entities",
  "signal.demographics.gender",
  "signal.interests.tags",
  "offset",
  "take",
]);

export const LIMITS = {
  searchTake: 5,
  discoveryTake: 20,
  maxRetries: 2,
  requestTimeoutMs: 20_000,
  delayBetweenRequestsMs: 150,
} as const;
