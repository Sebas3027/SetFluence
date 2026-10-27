/**
 * Shared domain contracts for SetFluence (backend + frontend).
 *
 * Architectural invariants:
 * - Cultural scores represent "relative fit within this shortlist" (ordinal 0.0–1.0),
 *   never audience percentages or probabilities.
 * - Missing or truncated candidate results are represented as `null` (unknown), never 0.0.
 * - Commercial constraints are evaluated deterministically by the solver, never by the LLM.
 */

export type EntityMatchStatus = "resolved" | "ambiguous" | "fuzzy" | "unresolved";

export type QlooEntityType =
  | "urn:entity:artist"
  | "urn:entity:brand"
  | "urn:entity:movie"
  | "urn:entity:tv_show"
  | "urn:entity:book"
  | "urn:entity:podcast"
  | "urn:entity:video_game"
  | "urn:entity:destination"
  | "urn:entity:place"
  | "urn:entity:person";

export interface ResolvedEntity {
  inputName: string;
  canonicalName: string | null;
  qlooId: string | null;
  entityType: QlooEntityType | string;
  status: EntityMatchStatus;
  matchConfidence: number;
  popularity: number | null;
  alternatives: Array<{
    qlooId: string;
    name: string;
    popularity: number | null;
  }>;
  resolvedAt: string;
  rawMetadata?: Record<string, unknown>;
}

export type SpaceFootprint = "compact" | "medium" | "large";
export type NoiseLevel = "quiet" | "moderate" | "loud";
export type StageCapacityTier = "headliner_arena" | "secondary_stage" | "intimate_tent";

export interface ActivationFormat {
  id: string;
  name: string;
  requiredSpaceFootprint: SpaceFootprint;
  noiseLevelCeiling: NoiseLevel;
  stageTier?: StageCapacityTier;
}

export type BudgetConfirmationStatus = "confirmed" | "needs_confirmation" | "unknown";

export interface OrganizerBrandFacts {
  budgetStatus: BudgetConfirmationStatus;
  quotedPackageBudget?: number;
  supportedSpaceFootprints?: SpaceFootprint[];
  operatingNoiseLevel?: NoiseLevel;
  notes?: string;
}

export type CandidateSource = "supplied" | "discovered" | "both";

export interface CandidateBrand {
  qlooId: string;
  name: string;
  category: string;
  source: CandidateSource;
  available: boolean;
  popularity?: number | null;
  organizerFacts: OrganizerBrandFacts;
  /** Optional stage IDs this brand was specifically discovered or targeted for. If undefined, evaluated across all stages. */
  targetStageIds?: string[];
}

export type EvidenceQueryOperation =
  | "search"
  | "discover_brands"
  | "evaluate_shortlist"
  | "cultural_tags"
  | "cultural_insights";

export type EvidenceStatus = "ok" | "missing" | "error";

export interface EvidenceRecord {
  id: string;
  artistId: string;
  artistName: string;
  brandId: string;
  brandName: string;
  operation: EvidenceQueryOperation;
  queryParameters: Record<string, string | number>;
  timestamp: string;
  /** Raw affinity returned by Qloo; not globally comparable across separate artist queries. */
  rawScore: number | null;
  /** 1-based rank within the evaluated shortlist for this artist (`null` if not returned). */
  ordinalRank: number | null;
  /** Normalized ordinal score in [0.0, 1.0] within this shortlist (`null` if missing/unknown). */
  ordinalPoints: number | null;
  shortlistSize: number;
  /** Ratio of resolved stage artists that returned a valid score for this candidate (`0.0`–`1.0`). */
  coverageRatio: number;
  status: EvidenceStatus;
  sourceType: "live" | "cached_live" | "synthetic_fixture";
}

export interface CulturalTagEvidence {
  tagId: string;
  name: string;
  tagType: string;
  affinity: number | null;
  sourceEndpoint: "/v2/insights" | "/v2/tags";
  artistId: string;
  timestamp: string;
}

export type ConstraintType =
  | "category_exclusivity"
  | "category_ban"
  | "availability"
  | "locked_placement"
  | "format_mismatch";

export type ConstraintScope = "stage" | "festival";

export interface Constraint {
  id: string;
  type: ConstraintType;
  scope: ConstraintScope;
  active: boolean;
  stageId?: string;
  category?: string;
  brandId?: string;
  formatRequirement?: ActivationFormat;
  reason?: string;
}

export interface StageBrief {
  id: string;
  name: string;
  genreLabel: string;
  artists: string[];
  /** Optional organizer-supplied artist weights (defaults to equal 1.0 weights). */
  artistWeights?: Record<string, number>;
  activationFormat?: ActivationFormat;
}

export interface SuppliedBrandInput {
  name: string;
  category: string;
  available?: boolean;
  organizerFacts?: Partial<OrganizerBrandFacts>;
}

export interface FestivalBrief {
  id: string;
  name: string;
  location: string;
  stages: StageBrief[];
  preferredCategories: string[];
  suppliedBrands: SuppliedBrandInput[];
  constraints: Constraint[];
}

export type CrossDomainTouchstoneType =
  | "movie"
  | "tv_show"
  | "video_game"
  | "book"
  | "tag";

export interface CrossDomainTouchstone {
  id: string;
  name: string;
  domain: CrossDomainTouchstoneType;
  qlooEntityType: string;
  affinityScore: number | null;
  sourceEndpoint: "/v2/insights" | "/v2/tags";
}

export interface ActivationBrief {
  experienceTitle: string;
  visitorExperience: string;
  /** 3 distinct, suggestive fan immersion concept options tailored to this stage and sponsor. */
  fanActivityOptions?: string[];
  sponsorRole: string;
  culturalRationale: string;
  groundingEvidenceIds: string[];
  culturalTagsUsed: string[];
  /** Cross-domain Qloo entities or cultural tags associated with the stage lineup. */
  crossDomainTouchstones?: CrossDomainTouchstone[];
  /** Contrastive deterministic explanation of why this sponsor won this stage vs. other stages/candidates. */
  stageTradeoffSummary?: string;
  formatCompliance: {
    compliant: boolean;
    formatName: string;
    requiredSpaceFootprint: SpaceFootprint;
    noiseLevelCeiling: NoiseLevel;
    stageTier?: StageCapacityTier;
    notes: string;
  };
  openQuestions: string[];
}

export interface StageAllocation {
  stageId: string;
  stageName: string;
  primarySponsor: CandidateBrand | null;
  alternativeSponsor: CandidateBrand | null;
  /** Average ordinal points across supported stage artists ("relative fit within this shortlist"). */
  relativeFitScore: number | null;
  supportedArtistsCount: number;
  totalStageArtistsCount: number;
  coverageRatio: number;
  artistEvidence: EvidenceRecord[];
  satisfiedConstraintIds: string[];
  blockingReasons: string[];
  activationBrief: ActivationBrief | null;
  unansweredCommercialQuestion: string;
}

export interface PlanDiffEntry {
  stageId: string;
  field: "primarySponsor" | "alternativeSponsor" | "status" | "constraint";
  previousValue: string | null;
  nextValue: string | null;
  reason: string;
}

export type AgentToolName =
  | "resolveLineup"
  | "discoverBrands"
  | "evaluateShortlistFit"
  | "runPlanner"
  | "investigateUnfilledStage";

export interface AgentActionLogEntry {
  id: string;
  stepNumber: number;
  tool: AgentToolName;
  inputSummary: string;
  outputSummary: string;
  status: "ok" | "warning" | "error";
  timestamp: string;
  durationMs: number;
}

export interface StageBrandEvaluation {
  stageId: string;
  brandId: string;
  relativeFitScore: number | null;
  rawMeanScore: number | null;
  supportedArtistsCount: number;
  totalStageArtistsCount: number;
  coverageRatio: number;
  artistEvidence: EvidenceRecord[];
  eligible: boolean;
  satisfiedConstraintIds: string[];
  blockingReasons: string[];
}

export interface PlannerResult {
  allocations: StageAllocation[];
  matrix: StageBrandEvaluation[];
  unresolvedConflicts: string[];
  diffLog: PlanDiffEntry[];
}

export interface PlanVersion {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  briefSnapshot: FestivalBrief;
  resolvedArtists: Record<string, ResolvedEntity>;
  candidatePool: CandidateBrand[];
  evidenceRecords: EvidenceRecord[];
  matrix: StageBrandEvaluation[];
  allocations: StageAllocation[];
  unresolvedConflicts: string[];
  diffLog: PlanDiffEntry[];
  actionHistory: AgentActionLogEntry[];
  agentSummary: string;
}
