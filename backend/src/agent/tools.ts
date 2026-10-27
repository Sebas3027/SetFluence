import type {
  AgentActionLogEntry,
  AgentToolName,
  CandidateBrand,
  EvidenceRecord,
  FestivalBrief,
  PlannerResult,
  ResolvedEntity,
  StageAllocation,
} from "@setfluence/shared";
import type { QlooService } from "../services/qloo.service.ts";
import { runPlanner } from "../solver/planner.ts";

export interface AgentWorkspaceContext {
  brief: FestivalBrief;
  qlooService: QlooService;
  maxPoolSize: number;
  resolvedArtists: Record<string, ResolvedEntity>;
  candidatePool: CandidateBrand[];
  evidenceRecords: EvidenceRecord[];
  latestPlannerResult: PlannerResult | null;
  previousAllocations?: StageAllocation[];
  actionHistory: AgentActionLogEntry[];
}

export function createAgentWorkspaceContext(params: {
  brief: FestivalBrief;
  qlooService: QlooService;
  maxPoolSize?: number;
  resolvedArtists?: Record<string, ResolvedEntity>;
  candidatePool?: CandidateBrand[];
  evidenceRecords?: EvidenceRecord[];
  previousAllocations?: StageAllocation[];
}): AgentWorkspaceContext {
  return {
    brief: structuredClone(params.brief),
    qlooService: params.qlooService,
    maxPoolSize: params.maxPoolSize ?? 12,
    resolvedArtists: params.resolvedArtists
      ? structuredClone(params.resolvedArtists)
      : {},
    candidatePool: params.candidatePool
      ? structuredClone(params.candidatePool)
      : [],
    evidenceRecords: params.evidenceRecords
      ? structuredClone(params.evidenceRecords)
      : [],
    latestPlannerResult: null,
    previousAllocations: params.previousAllocations,
    actionHistory: [],
  };
}

async function recordToolStep<T>(
  ctx: AgentWorkspaceContext,
  tool: AgentToolName,
  inputSummary: string,
  fn: () => Promise<{ result: T; outputSummary: string; status?: "ok" | "warning" | "error" }>,
): Promise<T> {
  const stepNumber = ctx.actionHistory.length + 1;
  const startedAt = performance.now();
  const timestamp = new Date().toISOString();

  try {
    const { result, outputSummary, status = "ok" } = await fn();
    ctx.actionHistory.push({
      id: `step-${stepNumber}-${tool}`,
      stepNumber,
      tool,
      inputSummary,
      outputSummary,
      status,
      timestamp,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.actionHistory.push({
      id: `step-${stepNumber}-${tool}`,
      stepNumber,
      tool,
      inputSummary,
      outputSummary: `Error: ${message}`,
      status: "error",
      timestamp,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw err;
  }
}

/**
 * Tool 1: resolveLineup(artistsByStage)
 * Resolves all unique artist names across stages and any supplied brands in the brief.
 */
export async function toolResolveLineup(
  ctx: AgentWorkspaceContext,
  artistsByStage?: Record<string, string[]>,
): Promise<{
  resolvedArtistsCount: number;
  totalArtistsCount: number;
  resolvedSuppliedBrandsCount: number;
}> {
  const stageMap =
    artistsByStage ??
    Object.fromEntries(ctx.brief.stages.map((s) => [s.id, s.artists]));
  const uniqueArtists = [
    ...new Set(Object.values(stageMap).flat().map((a) => a.trim()).filter(Boolean)),
  ];

  return recordToolStep(
    ctx,
    "resolveLineup",
    `Resolve ${uniqueArtists.length} artists and ${ctx.brief.suppliedBrands.length} supplied brands`,
    async () => {
      for (const artistName of uniqueArtists) {
        if (ctx.resolvedArtists[artistName]?.qlooId) continue;
        const matches = await ctx.qlooService.searchEntity(
          artistName,
          "urn:entity:artist",
        );
        if (matches[0]) {
          ctx.resolvedArtists[artistName] = matches[0];
        }
      }

      const existingBrandIds = new Set(ctx.candidatePool.map((b) => b.qlooId));
      let suppliedResolved = 0;

      for (const supplied of ctx.brief.suppliedBrands) {
        const matches = await ctx.qlooService.searchEntity(
          supplied.name,
          "urn:entity:brand",
        );
        const match = matches[0];
        if (match?.qlooId) {
          suppliedResolved++;
          const existing = ctx.candidatePool.find((b) => b.qlooId === match.qlooId);
          if (existing) {
            existing.category = supplied.category || existing.category;
            if (supplied.available !== undefined) {
              existing.available = supplied.available;
            }
            if (supplied.organizerFacts) {
              existing.organizerFacts = {
                ...existing.organizerFacts,
                ...supplied.organizerFacts,
              };
            }
          } else if (!existingBrandIds.has(match.qlooId)) {
            existingBrandIds.add(match.qlooId);
            ctx.candidatePool.push({
              qlooId: match.qlooId,
              name: match.canonicalName ?? supplied.name,
              category: supplied.category,
              source: "supplied",
              available: supplied.available ?? true,
              popularity: match.popularity,
              organizerFacts: {
                budgetStatus: "unknown",
                ...supplied.organizerFacts,
              },
            });
          }
        }
      }

      const resolvedArtistsCount = uniqueArtists.filter((name) =>
        Boolean(ctx.resolvedArtists[name]?.qlooId),
      ).length;

      return {
        result: {
          resolvedArtistsCount,
          totalArtistsCount: uniqueArtists.length,
          resolvedSuppliedBrandsCount: suppliedResolved,
        },
        outputSummary: `Resolved ${resolvedArtistsCount}/${uniqueArtists.length} artists and ${suppliedResolved}/${ctx.brief.suppliedBrands.length} supplied brands (pool size: ${ctx.candidatePool.length}).`,
      };
    },
  );
}

/**
  * Tool 2: discoverBrands(artistIds, category?)
  * Queries Qloo open brand discovery from artist signals and merges new candidates into candidatePool.
  * Tags stage-discovered brands with `targetStageIds` so each stage's leaderboard features distinct, genre-relevant discoveries
  * alongside the cross-stage organizer-supplied brands.
  */
export async function toolDiscoverBrands(
  ctx: AgentWorkspaceContext,
  artistIds: string[],
  category?: string,
): Promise<{ addedBrands: CandidateBrand[]; poolSize: number }> {
  const targetArtistIds =
    artistIds.length > 0
      ? artistIds
      : Object.values(ctx.resolvedArtists)
          .map((a) => a.qlooId)
          .filter((id): id is string => Boolean(id));

  return recordToolStep(
    ctx,
    "discoverBrands",
    `Discover stage-tailored brands from ${targetArtistIds.length} artist signal(s)${category ? ` in category "${category}"` : ""}`,
    async () => {
      const festivalBannedCategories = new Set(
        ctx.brief.constraints
          .filter(
            (c) => c.active && c.type === "category_ban" && c.scope === "festival" && c.category,
          )
          .map((c) => c.category!.trim().toLowerCase()),
      );

      // Map each artist Qloo ID to the stage IDs they perform on
      const stageIdsByArtistId = new Map<string, string[]>();
      for (const stage of ctx.brief.stages) {
        for (const artistName of stage.artists) {
          const qlooId = ctx.resolvedArtists[artistName]?.qlooId;
          if (!qlooId) continue;
          const list = stageIdsByArtistId.get(qlooId) ?? [];
          if (!list.includes(stage.id)) list.push(stage.id);
          stageIdsByArtistId.set(qlooId, list);
        }
      }

      const existingById = new Map(ctx.candidatePool.map((b) => [b.qlooId, b]));
      const addedBrands: CandidateBrand[] = [];
      const perStageDiscoverQuota = Math.max(
        2,
        Math.ceil((ctx.maxPoolSize - ctx.brief.suppliedBrands.length) / Math.max(1, ctx.brief.stages.length)),
      );
      const discoveredCountByStage = new Map<string, number>();

      for (let idx = 0; idx < targetArtistIds.length; idx++) {
        const artistId = targetArtistIds[idx]!;
        if (ctx.candidatePool.length >= ctx.maxPoolSize) break;

        const artistStages = stageIdsByArtistId.get(artistId) ?? [];
        const primaryStageId = artistStages[0];

        // Pick a category variation per stage if no explicit category was forced
        const stageCategory =
          category ??
          ctx.brief.preferredCategories[idx % Math.max(1, ctx.brief.preferredCategories.length)];

        const discovered = await ctx.qlooService.discoverCandidateBrands(
          artistId,
          stageCategory,
        );

        for (const candidate of discovered) {
          if (ctx.candidatePool.length >= ctx.maxPoolSize) break;
          if (
            festivalBannedCategories.has(candidate.category.trim().toLowerCase())
          ) {
            continue;
          }

          const existing = existingById.get(candidate.qlooId);
          if (existing) {
            // If it was already discovered for another stage and that stage has room, keep it distinct per stage
            continue;
          }

          if (primaryStageId) {
            const currentStageCount = discoveredCountByStage.get(primaryStageId) ?? 0;
            if (currentStageCount >= perStageDiscoverQuota && targetArtistIds.length > 1) {
              continue;
            }
            discoveredCountByStage.set(primaryStageId, currentStageCount + 1);
          }

          const taggedCandidate: CandidateBrand = {
            ...candidate,
            ...(artistStages.length > 0 ? { targetStageIds: artistStages } : {}),
          };

          existingById.set(taggedCandidate.qlooId, taggedCandidate);
          ctx.candidatePool.push(taggedCandidate);
          addedBrands.push(taggedCandidate);
        }
      }

      return {
        result: {
          addedBrands,
          poolSize: ctx.candidatePool.length,
        },
        outputSummary: `Added ${addedBrands.length} stage-tailored discovered brand(s) (${addedBrands.map((b) => b.name).join(", ") || "none"}); candidate pool now has ${ctx.candidatePool.length} brand(s).`,
      };
    },
  );
}

/**
 * Tool 3: evaluateShortlistFit(artistIds, brandIds)
 * Evaluates the common candidate pool against resolved artists.
 * Safeguard: Always recomputes ordinal rankings across the entire current shortlist so indices are never mixed.
 */
export async function toolEvaluateShortlistFit(
  ctx: AgentWorkspaceContext,
  artistIds?: string[],
  brandIds?: string[],
): Promise<{ evaluatedArtists: number; shortlistSize: number; totalRecords: number }> {
  const brandsToEvaluate =
    brandIds && brandIds.length > 0
      ? ctx.candidatePool.filter((b) => brandIds.includes(b.qlooId))
      : ctx.candidatePool;

  const resolvedArtistEntries = Object.values(ctx.resolvedArtists).filter(
    (a): a is ResolvedEntity & { qlooId: string } => Boolean(a.qlooId),
  );
  const artistsToEvaluate =
    artistIds && artistIds.length > 0
      ? resolvedArtistEntries.filter((a) => artistIds.includes(a.qlooId))
      : resolvedArtistEntries;

  return recordToolStep(
    ctx,
    "evaluateShortlistFit",
    `Evaluate ${brandsToEvaluate.length} shortlisted brand(s) across ${artistsToEvaluate.length} resolved artist(s)`,
    async () => {
      const freshRecords: EvidenceRecord[] = [];

      // Map each artist Qloo ID to the stage IDs they perform on so rank #1..#N reflects that stage's shortlist
      const stageIdsByArtistId = new Map<string, string[]>();
      for (const stage of ctx.brief.stages) {
        for (const artistName of stage.artists) {
          const qlooId = ctx.resolvedArtists[artistName]?.qlooId;
          if (!qlooId) continue;
          const list = stageIdsByArtistId.get(qlooId) ?? [];
          if (!list.includes(stage.id)) list.push(stage.id);
          stageIdsByArtistId.set(qlooId, list);
        }
      }

      for (const artist of artistsToEvaluate) {
        const artistStages = stageIdsByArtistId.get(artist.qlooId) ?? [];
        const stageSpecificBrands =
          artistStages.length > 0
            ? brandsToEvaluate.filter(
                (b) =>
                  !b.targetStageIds ||
                  b.targetStageIds.length === 0 ||
                  b.targetStageIds.some((sid) => artistStages.includes(sid)),
              )
            : brandsToEvaluate;

        const records = await ctx.qlooService.evaluateShortlistWithEvidence(
          {
            qlooId: artist.qlooId,
            name: artist.canonicalName ?? artist.inputName,
          },
          stageSpecificBrands.map((b) => ({ qlooId: b.qlooId, name: b.name })),
        );
        freshRecords.push(...records);
      }

      // Replace records for the evaluated artists so ordinal rankings reflect the current shortlist size
      const evaluatedArtistIdSet = new Set(artistsToEvaluate.map((a) => a.qlooId));
      ctx.evidenceRecords = [
        ...ctx.evidenceRecords.filter(
          (r) => !evaluatedArtistIdSet.has(r.artistId),
        ),
        ...freshRecords,
      ];

      return {
        result: {
          evaluatedArtists: artistsToEvaluate.length,
          shortlistSize: brandsToEvaluate.length,
          totalRecords: ctx.evidenceRecords.length,
        },
        outputSummary: `Computed ordinal fit rankings across ${brandsToEvaluate.length} brands for ${artistsToEvaluate.length} artists (${freshRecords.filter((r) => r.status === "ok").length} supported artist-brand pairs).`,
      };
    },
  );
}

/**
 * Tool 4: runPlanner(brief, candidatePool)
 * Invokes the deterministic Phase 2 constraint solver.
 */
export async function toolRunPlanner(
  ctx: AgentWorkspaceContext,
): Promise<PlannerResult> {
  return recordToolStep(
    ctx,
    "runPlanner",
    `Run deterministic solver across ${ctx.brief.stages.length} stages and ${ctx.candidatePool.length} candidates`,
    async () => {
      const resolvedArtistIdsByName: Record<string, string | null> = {};
      for (const stage of ctx.brief.stages) {
        for (const artistName of stage.artists) {
          resolvedArtistIdsByName[artistName] =
            ctx.resolvedArtists[artistName]?.qlooId ?? null;
        }
      }

      const plannerResult = runPlanner({
        brief: ctx.brief,
        candidatePool: ctx.candidatePool,
        resolvedArtistIdsByName,
        evidenceRecords: ctx.evidenceRecords,
        previousAllocations: ctx.previousAllocations,
      });

      ctx.latestPlannerResult = plannerResult;

      const filledStages = plannerResult.allocations.filter((a) =>
        Boolean(a.primarySponsor),
      ).length;
      const summaryParts = plannerResult.allocations.map(
        (a) =>
          `${a.stageName}: ${a.primarySponsor ? `${a.primarySponsor.name} (fit ${a.relativeFitScore?.toFixed(2)})` : "UNFILLED"}`,
      );

      const status =
        plannerResult.unresolvedConflicts.length > 0 ||
        filledStages < ctx.brief.stages.length
          ? "warning"
          : "ok";

      return {
        result: plannerResult,
        status,
        outputSummary: `Allocated ${filledStages}/${ctx.brief.stages.length} stages (${summaryParts.join(" | ")}) with ${plannerResult.unresolvedConflicts.length} conflict(s).`,
      };
    },
  );
}

/**
 * Tool 5: investigateUnfilledStage(stageId, allowedCategories)
 * Inspects why a stage is unfilled, checks whether a hard lock conflict prevents recovery,
 * and otherwise discovers new candidate brands in allowed categories, recomputes shortlist fit, and re-runs the solver.
 */
export async function toolInvestigateUnfilledStage(
  ctx: AgentWorkspaceContext,
  stageId: string,
  allowedCategories?: string[],
): Promise<{
  recovered: boolean;
  allocatedBrandName: string | null;
  blockingReasons: string[];
}> {
  const stage = ctx.brief.stages.find((s) => s.id === stageId);
  const categoriesToTry =
    allowedCategories && allowedCategories.length > 0
      ? allowedCategories
      : deriveAllowedCategoriesForStage(ctx.brief, stageId, ctx.latestPlannerResult);

  return recordToolStep(
    ctx,
    "investigateUnfilledStage",
    `Investigate unfilled stage "${stage?.name ?? stageId}" (allowed categories: ${categoriesToTry.join(", ") || "any"})`,
    async () => {
      if (!stage) {
        return {
          result: {
            recovered: false,
            allocatedBrandName: null,
            blockingReasons: [`Stage "${stageId}" not found in brief.`],
          },
          status: "error",
          outputSummary: `Stage "${stageId}" not found.`,
        };
      }

      // If the stage has an active locked_placement that conflicts with a hard rule, discovery cannot override a lock
      const hasLockedConflict = ctx.brief.constraints.some(
        (c) =>
          c.active &&
          c.type === "locked_placement" &&
          c.stageId === stageId,
      );
      if (
        hasLockedConflict &&
        (ctx.latestPlannerResult?.unresolvedConflicts.length ?? 0) > 0
      ) {
        const currentAlloc = ctx.latestPlannerResult?.allocations.find(
          (a) => a.stageId === stageId,
        );
        return {
          result: {
            recovered: false,
            allocatedBrandName: null,
            blockingReasons:
              currentAlloc?.blockingReasons ??
              ctx.latestPlannerResult!.unresolvedConflicts,
          },
          status: "warning",
          outputSummary: `Stage "${stage.name}" is blocked by a conflicting locked placement; cannot override without organizer decision.`,
        };
      }

      const stageArtistIds = stage.artists
        .map((name) => ctx.resolvedArtists[name]?.qlooId)
        .filter((id): id is string => Boolean(id));

      const existingIds = new Set(ctx.candidatePool.map((b) => b.qlooId));
      const newlyDiscovered: CandidateBrand[] = [];

      // Raise pool ceiling slightly during recovery so new candidates can be evaluated
      const recoveryCeiling = Math.max(ctx.maxPoolSize, ctx.candidatePool.length + 4);

      const categoriesList =
        categoriesToTry.length > 0 ? categoriesToTry : [undefined];

      for (const category of categoriesList) {
        for (const artistId of stageArtistIds) {
          if (ctx.candidatePool.length >= recoveryCeiling) break;
          const discovered = await ctx.qlooService.discoverCandidateBrands(
            artistId,
            category,
          );
          for (const brand of discovered) {
            if (ctx.candidatePool.length >= recoveryCeiling) break;
            if (existingIds.has(brand.qlooId)) continue;
            if (isCategoryBlockedOnStage(ctx.brief, stageId, brand.category)) {
              continue;
            }
            const taggedBrand: CandidateBrand = {
              ...brand,
              targetStageIds: [stageId],
            };
            existingIds.add(taggedBrand.qlooId);
            ctx.candidatePool.push(taggedBrand);
            newlyDiscovered.push(taggedBrand);
          }
        }
      }

      if (newlyDiscovered.length > 0) {
        // Re-evaluate shortlist across resolved artists using each stage's targeted brand shortlist
        const allResolvedArtists = Object.values(ctx.resolvedArtists).filter(
          (a): a is ResolvedEntity & { qlooId: string } => Boolean(a.qlooId),
        );
        const stageIdsByArtistId = new Map<string, string[]>();
        for (const st of ctx.brief.stages) {
          for (const artistName of st.artists) {
            const qlooId = ctx.resolvedArtists[artistName]?.qlooId;
            if (!qlooId) continue;
            const list = stageIdsByArtistId.get(qlooId) ?? [];
            if (!list.includes(st.id)) list.push(st.id);
            stageIdsByArtistId.set(qlooId, list);
          }
        }

        const updatedRecords: EvidenceRecord[] = [];
        for (const artist of allResolvedArtists) {
          const artistStages = stageIdsByArtistId.get(artist.qlooId) ?? [];
          const stageSpecificBrands =
            artistStages.length > 0
              ? ctx.candidatePool.filter(
                  (b) =>
                    !b.targetStageIds ||
                    b.targetStageIds.length === 0 ||
                    b.targetStageIds.some((sid) => artistStages.includes(sid)),
                )
              : ctx.candidatePool;

          const recs = await ctx.qlooService.evaluateShortlistWithEvidence(
            {
              qlooId: artist.qlooId,
              name: artist.canonicalName ?? artist.inputName,
            },
            stageSpecificBrands.map((b) => ({ qlooId: b.qlooId, name: b.name })),
          );
          updatedRecords.push(...recs);
        }
        ctx.evidenceRecords = updatedRecords;

        // Re-run deterministic solver
        const resolvedArtistIdsByName: Record<string, string | null> = {};
        for (const st of ctx.brief.stages) {
          for (const name of st.artists) {
            resolvedArtistIdsByName[name] =
              ctx.resolvedArtists[name]?.qlooId ?? null;
          }
        }
        ctx.latestPlannerResult = runPlanner({
          brief: ctx.brief,
          candidatePool: ctx.candidatePool,
          resolvedArtistIdsByName,
          evidenceRecords: ctx.evidenceRecords,
          previousAllocations: ctx.previousAllocations,
        });
      }

      const updatedStageAlloc = ctx.latestPlannerResult?.allocations.find(
        (a) => a.stageId === stageId,
      );
      const recovered = Boolean(updatedStageAlloc?.primarySponsor);

      return {
        result: {
          recovered,
          allocatedBrandName: updatedStageAlloc?.primarySponsor?.name ?? null,
          blockingReasons: updatedStageAlloc?.blockingReasons ?? [],
        },
        status: recovered ? "ok" : "warning",
        outputSummary: recovered
          ? `Discovered ${newlyDiscovered.length} new candidate(s) and recovered stage "${stage.name}" with "${updatedStageAlloc?.primarySponsor?.name}".`
          : `Stage "${stage.name}" remains unfilled after inspecting ${newlyDiscovered.length} new candidate(s).`,
      };
    },
  );
}

function isCategoryBlockedOnStage(
  brief: FestivalBrief,
  stageId: string,
  category: string,
): boolean {
  const norm = category.trim().toLowerCase();
  return brief.constraints.some(
    (c) =>
      c.active &&
      c.type === "category_ban" &&
      (c.scope === "festival" || c.stageId === stageId) &&
      c.category?.trim().toLowerCase() === norm,
  );
}

export function deriveAllowedCategoriesForStage(
  brief: FestivalBrief,
  stageId: string,
  latestPlannerResult: PlannerResult | null,
): string[] {
  const occupiedExclusiveCategories = new Set<string>();
  const activeFestivalExclusivities = brief.constraints.filter(
    (c) => c.active && c.type === "category_exclusivity" && c.scope === "festival",
  );

  if (latestPlannerResult && activeFestivalExclusivities.length > 0) {
    for (const alloc of latestPlannerResult.allocations) {
      if (alloc.stageId === stageId || !alloc.primarySponsor) continue;
      const cat = alloc.primarySponsor.category.trim().toLowerCase();
      const isExclusive = activeFestivalExclusivities.some(
        (rule) =>
          !rule.category ||
          rule.category === "*" ||
          rule.category.trim().toLowerCase() === cat,
      );
      if (isExclusive) {
        occupiedExclusiveCategories.add(cat);
      }
    }
  }

  return brief.preferredCategories.filter((cat) => {
    const norm = cat.trim().toLowerCase();
    return (
      !isCategoryBlockedOnStage(brief, stageId, norm) &&
      !occupiedExclusiveCategories.has(norm)
    );
  });
}
