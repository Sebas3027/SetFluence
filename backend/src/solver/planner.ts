import type {
  CandidateBrand,
  EvidenceRecord,
  FestivalBrief,
  PlanDiffEntry,
  PlannerResult,
  StageAllocation,
  StageBrandEvaluation,
} from "@setfluence/shared";
import {
  detectBriefConflicts,
  evaluateStageCandidateEligibility,
  isFestivalAssignmentFeasible,
} from "./constraints.ts";
import { computeStageBrandFit } from "./scoring.ts";

const SCORE_EPSILON = 1e-4;

export interface PlannerInput {
  brief: FestivalBrief;
  candidatePool: CandidateBrand[];
  /** Map of artist input name -> resolved Qloo entity ID (`null` if unresolved). */
  resolvedArtistIdsByName: Record<string, string | null>;
  evidenceRecords: EvidenceRecord[];
  /** Optional previous allocations used for minimal-churn tie-breaking and diff generation. */
  previousAllocations?: StageAllocation[];
}

interface EvaluatedTuple {
  brands: Array<CandidateBrand | null>;
  filledCount: number;
  totalFitScore: number;
  meanCoverage: number;
  preservedPreviousCount: number;
  satisfiedExclusivityIds: string[];
}

/**
 * Deterministic enumeration solver for 3-stage festival sponsorship allocation.
 *
 * Guarantees:
 * - Hard commercial rules (availability, category bans, category exclusivity, locked placements,
 *   stage activation format ceilings) are strictly enforced.
 * - Locked placements that conflict with another hard rule are surfaced in `unresolvedConflicts`
 *   and never silently bypass the conflicting rule.
 * - Candidates with 0 supported stage artists (`relativeFitScore === null`) are never allocated.
 * - For each stage, `alternativeSponsor` is guaranteed to be feasible within the full festival plan.
 */
export function runPlanner(input: PlannerInput): PlannerResult {
  const {
    brief,
    candidatePool,
    resolvedArtistIdsByName,
    evidenceRecords,
    previousAllocations,
  } = input;

  const unresolvedConflicts = detectBriefConflicts(brief, candidatePool);
  const brandsById = new Map(candidatePool.map((b) => [b.qlooId, b]));

  // 1. Build the Stage x Brand evaluation matrix
  // Organizer-supplied brands (no targetStageIds) are evaluated across all stages for cross-stage routing,
  // while stage-specific Qloo discoveries (with targetStageIds) are evaluated on their targeted stage(s).
  const matrix: StageBrandEvaluation[] = [];
  const evalByStageAndBrand = new Map<string, StageBrandEvaluation>();

  for (const stage of brief.stages) {
    const stageCandidates = candidatePool.filter(
      (b) =>
        !b.targetStageIds ||
        b.targetStageIds.length === 0 ||
        b.targetStageIds.includes(stage.id),
    );

    for (const brand of stageCandidates) {
      const scoreMetrics = computeStageBrandFit(
        stage,
        brand,
        resolvedArtistIdsByName,
        evidenceRecords,
      );
      const eligibility = evaluateStageCandidateEligibility(
        stage,
        brand,
        brief.constraints,
      );

      const blockingReasons = [...eligibility.blockingReasons];
      if (scoreMetrics.supportedArtistsCount === 0) {
        blockingReasons.push(
          `No Qloo cultural affinity evidence returned for "${brand.name}" across resolved artists on "${stage.name}".`,
        );
      }

      const evaluation: StageBrandEvaluation = {
        ...scoreMetrics,
        eligible:
          eligibility.eligible && scoreMetrics.supportedArtistsCount > 0,
        satisfiedConstraintIds: eligibility.satisfiedConstraintIds,
        blockingReasons,
      };

      matrix.push(evaluation);
      evalByStageAndBrand.set(`${stage.id}:${brand.qlooId}`, evaluation);
    }
  }

  // 2. Build per-stage candidate domain for enumeration
  // Each stage can pick any stage-eligible brand, or `null` (unfilled) if blocked by cross-stage rules.
  const stageDomains: Array<Array<CandidateBrand | null>> = brief.stages.map(
    (stage) => {
      const eligibleBrands = candidatePool.filter(
        (b) => evalByStageAndBrand.get(`${stage.id}:${b.qlooId}`)?.eligible,
      );
      return [...eligibleBrands, null];
    },
  );

  const previousPrimaryByStageId = new Map<string, string | null>();
  if (previousAllocations) {
    for (const prev of previousAllocations) {
      previousPrimaryByStageId.set(
        prev.stageId,
        prev.primarySponsor?.qlooId ?? null,
      );
    }
  }

  const lockedStageIds = new Set(
    brief.constraints
      .filter((c) => c.active && c.type === "locked_placement" && c.stageId)
      .map((c) => c.stageId!),
  );

  // 3. Exact enumeration over all stage combinations
  const state: { bestTuple: EvaluatedTuple | null } = { bestTuple: null };
  const stageCount = brief.stages.length;
  const currentSelection: Array<CandidateBrand | null> = new Array(stageCount).fill(
    null,
  );

  const search = (stageIndex: number): void => {
    if (stageIndex === stageCount) {
      const assignment = brief.stages.map((st, idx) => ({
        stageId: st.id,
        brand: currentSelection[idx] ?? null,
      }));

      const festivalCheck = isFestivalAssignmentFeasible(
        assignment,
        brief.constraints,
      );
      if (!festivalCheck.feasible) return;

      let filledCount = 0;
      let totalFitScore = 0;
      let coverageSum = 0;
      let preservedPreviousCount = 0;

      for (let i = 0; i < stageCount; i++) {
        const stage = brief.stages[i]!;
        const chosen = currentSelection[i] ?? null;

        if (chosen) {
          const ev = evalByStageAndBrand.get(`${stage.id}:${chosen.qlooId}`);
          if (!ev || ev.relativeFitScore === null) return;
          filledCount++;
          totalFitScore += ev.relativeFitScore;
          coverageSum += ev.coverageRatio;
        }

        if (
          previousAllocations &&
          !lockedStageIds.has(stage.id) &&
          previousPrimaryByStageId.get(stage.id) === (chosen?.qlooId ?? null)
        ) {
          preservedPreviousCount++;
        }
      }

      const candidateTuple: EvaluatedTuple = {
        brands: [...currentSelection],
        filledCount,
        totalFitScore: Number(totalFitScore.toFixed(4)),
        meanCoverage:
          filledCount > 0 ? Number((coverageSum / filledCount).toFixed(4)) : 0,
        preservedPreviousCount,
        satisfiedExclusivityIds: festivalCheck.satisfiedExclusivityIds,
      };

      if (!state.bestTuple || isBetterTuple(candidateTuple, state.bestTuple)) {
        state.bestTuple = candidateTuple;
      }
      return;
    }

    const domain = stageDomains[stageIndex] ?? [null];
    for (const option of domain) {
      currentSelection[stageIndex] = option;
      search(stageIndex + 1);
    }
  };

  if (stageCount > 0) {
    search(0);
  }

  const winningBrands =
    state.bestTuple?.brands ??
    new Array<CandidateBrand | null>(stageCount).fill(null);
  const winningExclusivityIds = state.bestTuple?.satisfiedExclusivityIds ?? [];

  // 4. Construct StageAllocations + Festival-Wide Feasible Alternatives (Section 2.3)
  const allocations: StageAllocation[] = brief.stages.map((stage, stageIdx) => {
    const primary = winningBrands[stageIdx] ?? null;
    const primaryEval = primary
      ? evalByStageAndBrand.get(`${stage.id}:${primary.qlooId}`)
      : undefined;

    // Find best alternative sponsor for `stage` that is feasible across the ENTIRE festival plan
    const alternative = findBestFestivalFeasibleAlternative(
      stageIdx,
      brief,
      candidatePool,
      winningBrands,
      evalByStageAndBrand,
    );

    const blockingReasons = primary
      ? []
      : summarizeStageUnfilledReasons(
          stage.id,
          stage.name,
          candidatePool,
          evalByStageAndBrand,
          winningBrands,
          brief,
        );

    const satisfiedConstraintIds = primaryEval
      ? [
          ...new Set([
            ...primaryEval.satisfiedConstraintIds,
            ...winningExclusivityIds,
          ]),
        ]
      : [];

    return {
      stageId: stage.id,
      stageName: stage.name,
      primarySponsor: primary,
      alternativeSponsor: alternative,
      relativeFitScore: primaryEval?.relativeFitScore ?? null,
      supportedArtistsCount: primaryEval?.supportedArtistsCount ?? 0,
      totalStageArtistsCount: stage.artists.length,
      coverageRatio: primaryEval?.coverageRatio ?? 0,
      artistEvidence: primaryEval?.artistEvidence ?? [],
      satisfiedConstraintIds,
      blockingReasons,
      activationBrief: null,
      unansweredCommercialQuestion: buildCommercialQuestion(stage, primary),
    };
  });

  // 5. Compute revision diff log if previousAllocations were provided
  const diffLog = previousAllocations
    ? computePlanDiff(previousAllocations, allocations, brandsById)
    : [];

  return {
    allocations,
    matrix,
    unresolvedConflicts,
    diffLog,
  };
}

/**
 * Strict comparator ranking two feasible festival-wide assignments:
 * 1. Higher number of filled stages
 * 2. Higher total supported cultural fit (outside SCORE_EPSILON)
 * 3. Higher mean artist coverage ratio (outside SCORE_EPSILON)
 * 4. Fewer changes to unlocked stages from previousAllocations
 */
function isBetterTuple(candidate: EvaluatedTuple, incumbent: EvaluatedTuple): boolean {
  if (candidate.filledCount !== incumbent.filledCount) {
    return candidate.filledCount > incumbent.filledCount;
  }

  const fitDelta = candidate.totalFitScore - incumbent.totalFitScore;
  if (Math.abs(fitDelta) > SCORE_EPSILON) {
    return fitDelta > 0;
  }

  const coverageDelta = candidate.meanCoverage - incumbent.meanCoverage;
  if (Math.abs(coverageDelta) > SCORE_EPSILON) {
    return coverageDelta > 0;
  }

  if (candidate.preservedPreviousCount !== incumbent.preservedPreviousCount) {
    return candidate.preservedPreviousCount > incumbent.preservedPreviousCount;
  }

  return false;
}

/**
 * Selects the highest-fit fallback candidate for `stageIdx` that:
 * - Is not the stage's current `primarySponsor`
 * - Is stage-eligible on `stageIdx`
 * - Is festival-wide feasible when substituted into `stageIdx` alongside the other stages' primary sponsors
 */
function findBestFestivalFeasibleAlternative(
  stageIdx: number,
  brief: FestivalBrief,
  candidatePool: CandidateBrand[],
  winningBrands: Array<CandidateBrand | null>,
  evalByStageAndBrand: Map<string, StageBrandEvaluation>,
): CandidateBrand | null {
  const stage = brief.stages[stageIdx]!;
  const currentPrimary = winningBrands[stageIdx] ?? null;

  // If the stage has an active locked placement, no alternative can replace the locked sponsor without changing the lock
  const isStageLocked = brief.constraints.some(
    (c) => c.active && c.type === "locked_placement" && c.stageId === stage.id,
  );
  if (isStageLocked) return null;

  let bestAlt: CandidateBrand | null = null;
  let bestEval: StageBrandEvaluation | null = null;

  for (const candidate of candidatePool) {
    if (currentPrimary && candidate.qlooId === currentPrimary.qlooId) continue;

    const ev = evalByStageAndBrand.get(`${stage.id}:${candidate.qlooId}`);
    if (!ev || !ev.eligible || ev.relativeFitScore === null) continue;

    const hypotheticalAssignment = brief.stages.map((st, idx) => ({
      stageId: st.id,
      brand: idx === stageIdx ? candidate : (winningBrands[idx] ?? null),
    }));

    const check = isFestivalAssignmentFeasible(
      hypotheticalAssignment,
      brief.constraints,
    );
    if (!check.feasible) continue;

    if (
      !bestEval ||
      ev.relativeFitScore - (bestEval.relativeFitScore ?? 0) > SCORE_EPSILON ||
      (Math.abs(ev.relativeFitScore - (bestEval.relativeFitScore ?? 0)) <=
        SCORE_EPSILON &&
        ev.coverageRatio > bestEval.coverageRatio)
    ) {
      bestAlt = candidate;
      bestEval = ev;
    }
  }

  return bestAlt;
}

function summarizeStageUnfilledReasons(
  stageId: string,
  stageName: string,
  candidatePool: CandidateBrand[],
  evalByStageAndBrand: Map<string, StageBrandEvaluation>,
  winningBrands: Array<CandidateBrand | null>,
  brief: FestivalBrief,
): string[] {
  if (candidatePool.length === 0) {
    return [`No candidate brands in pool to evaluate for "${stageName}".`];
  }

  const reasons = new Set<string>();
  const stageEligibleBrands: CandidateBrand[] = [];

  for (const brand of candidatePool) {
    const ev = evalByStageAndBrand.get(`${stageId}:${brand.qlooId}`);
    if (!ev) continue;
    if (ev.eligible) {
      stageEligibleBrands.push(brand);
    } else {
      for (const r of ev.blockingReasons) {
        reasons.add(r);
      }
    }
  }

  // If some brands were eligible at the stage level, explain why festival-wide constraints blocked them
  for (const brand of stageEligibleBrands) {
    const hypothetical = brief.stages.map((st, idx) => ({
      stageId: st.id,
      brand: st.id === stageId ? brand : (winningBrands[idx] ?? null),
    }));
    const festivalCheck = isFestivalAssignmentFeasible(
      hypothetical,
      brief.constraints,
    );
    for (const v of festivalCheck.violationReasons) {
      reasons.add(v);
    }
  }

  if (reasons.size === 0) {
    reasons.add(`No feasible sponsor assignment found for stage "${stageName}".`);
  }

  return [...reasons];
}

function buildCommercialQuestion(
  stage: FestivalBrief["stages"][number],
  sponsor: CandidateBrand | null,
): string {
  if (!sponsor) {
    return "Which hard constraint should be relaxed or which new sponsor category should be searched to fill this stage?";
  }

  const questions: string[] = [];
  if (sponsor.organizerFacts.budgetStatus !== "confirmed") {
    questions.push(`Confirm "${sponsor.name}" package budget and commercial terms`);
  }

  if (stage.activationFormat) {
    const hasSpaceFact = Boolean(
      sponsor.organizerFacts.supportedSpaceFootprints?.length,
    );
    if (!hasSpaceFact) {
      const tierLabel = stage.activationFormat.stageTier
        ? stage.activationFormat.stageTier.replace(/_/g, " ")
        : "stage";
      questions.push(
        `Verify on-site activation complies with "${stage.activationFormat.name}" (${stage.activationFormat.requiredSpaceFootprint} footprint, ${tierLabel})`,
      );
    }
  }

  return questions.length > 0
    ? `${questions.join("; ")}.`
    : `Confirm final contract sign-off with "${sponsor.name}" for ${stage.name}.`;
}

function computePlanDiff(
  previousAllocations: StageAllocation[],
  nextAllocations: StageAllocation[],
  brandsById: Map<string, CandidateBrand>,
): PlanDiffEntry[] {
  const diffs: PlanDiffEntry[] = [];
  const prevByStageId = new Map(previousAllocations.map((a) => [a.stageId, a]));

  for (const next of nextAllocations) {
    const prev = prevByStageId.get(next.stageId);
    if (!prev) continue;

    const prevPrimaryName = prev.primarySponsor?.name ?? null;
    const nextPrimaryName = next.primarySponsor?.name ?? null;

    if (prevPrimaryName !== nextPrimaryName) {
      let reason = "Updated stage allocation to maximize festival-wide cultural fit under active constraints.";
      if (prev.primarySponsor) {
        const prevBrandCurrentState = brandsById.get(prev.primarySponsor.qlooId);
        if (prevBrandCurrentState && !prevBrandCurrentState.available) {
          reason = `Previous sponsor "${prev.primarySponsor.name}" was marked unavailable.`;
        } else if (!next.primarySponsor && next.blockingReasons.length > 0) {
          reason = next.blockingReasons[0]!;
        }
      }

      diffs.push({
        stageId: next.stageId,
        field: "primarySponsor",
        previousValue: prevPrimaryName,
        nextValue: nextPrimaryName,
        reason,
      });
    }

    const prevAltName = prev.alternativeSponsor?.name ?? null;
    const nextAltName = next.alternativeSponsor?.name ?? null;
    if (prevAltName !== nextAltName) {
      diffs.push({
        stageId: next.stageId,
        field: "alternativeSponsor",
        previousValue: prevAltName,
        nextValue: nextAltName,
        reason: "Updated festival-wide feasible fallback sponsor.",
      });
    }
  }

  return diffs;
}
