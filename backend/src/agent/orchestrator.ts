import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import type {
  ActivationBrief,
  CandidateBrand,
  CrossDomainTouchstone,
  FestivalBrief,
  PlanVersion,
  StageAllocation,
  StageBrandEvaluation,
  StageBrief,
} from "@setfluence/shared";
import type { QlooService } from "../services/qloo.service.ts";
import {
  createAgentWorkspaceContext,
  deriveAllowedCategoriesForStage,
  toolDiscoverBrands,
  toolEvaluateShortlistFit,
  toolInvestigateUnfilledStage,
  toolResolveLineup,
  toolRunPlanner,
  type AgentWorkspaceContext,
} from "./tools.ts";

export interface AgentOrchestratorOptions {
  qlooService: QlooService;
  geminiApiKey?: string;
  geminiModel?: string;
  maxSteps?: number;
  maxPoolSize?: number;
  /** When false (or if no GEMINI_API_KEY is present), executes the bounded 5-tool state machine directly. */
  useLlmToolLoop?: boolean;
}

const AGENT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "resolveLineup",
    description:
      "Resolves festival stage artists and organizer-supplied brands into canonical Qloo entity IDs via GET /search.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "discoverBrands",
    description:
      "Discovers new candidate sponsor brands from Qloo GET /v2/insights using artist signals and an optional category filter.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        artistIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Qloo artist entity IDs to use as cultural interest signals.",
        },
        category: {
          type: Type.STRING,
          description: "Optional sponsor category keyword to filter discovered brands.",
        },
      },
    },
  },
  {
    name: "evaluateShortlistFit",
    description:
      "Evaluates the entire candidate brand shortlist against all resolved artists and computes ordinal 0.0-1.0 rankings.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "runPlanner",
    description:
      "Runs the deterministic constraint solver to allocate primary and fallback sponsors across stages under all hard rules.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "investigateUnfilledStage",
    description:
      "Recovers an unfilled stage by discovering candidate brands in allowed categories, recomputing shortlist fit, and re-running the solver.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        stageId: {
          type: Type.STRING,
          description: "The ID of the unfilled stage to investigate.",
        },
        allowedCategories: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Allowed sponsor categories to search for this stage.",
        },
      },
      required: ["stageId"],
    },
  },
];

export class AgentOrchestrator {
  private readonly qlooService: QlooService;
  private readonly geminiApiKey: string;
  private readonly geminiModel: string;
  private readonly maxSteps: number;
  private readonly maxPoolSize: number;
  private readonly useLlmToolLoop: boolean;

  constructor(options: AgentOrchestratorOptions) {
    this.qlooService = options.qlooService;
    this.geminiApiKey = (
      options.geminiApiKey ??
      process.env.GEMINI_API_KEY ??
      ""
    ).trim();
    this.geminiModel = options.geminiModel ?? "gemini-2.5-flash";
    this.maxSteps = options.maxSteps ?? 8;
    this.maxPoolSize = options.maxPoolSize ?? 16;
    this.useLlmToolLoop =
      options.useLlmToolLoop ?? Boolean(this.geminiApiKey);
  }

  /**
   * Generates the initial Version 1 sponsorship plan from a FestivalBrief.
   */
  async generateInitialPlan(brief: FestivalBrief): Promise<PlanVersion> {
    const ctx = createAgentWorkspaceContext({
      brief,
      qlooService: this.qlooService,
      maxPoolSize: this.maxPoolSize,
    });

    if (this.useLlmToolLoop && this.geminiApiKey) {
      try {
        await this.runGeminiToolLoop(ctx, "initial");
      } catch {
        // Ensure completion via bounded state machine if LLM call fails or stops early
        await this.ensureDeterministicCompletion(ctx, "initial");
      }
    } else {
      await this.ensureDeterministicCompletion(ctx, "initial");
    }

    await this.populateActivationBriefs(ctx);

    return this.buildPlanVersion(ctx, 1);
  }

  /**
   * Revises an existing PlanVersion when constraints, brand availability, or organizer instructions change.
   * Reuses resolved artists, candidate pool, and cached evidence first; invokes discovery only if a stage becomes unfilled.
   */
  async revisePlan(
    previousPlan: PlanVersion,
    updatedBrief: FestivalBrief,
    instruction?: string,
  ): Promise<PlanVersion> {
    const ctx = createAgentWorkspaceContext({
      brief: updatedBrief,
      qlooService: this.qlooService,
      maxPoolSize: this.maxPoolSize,
      resolvedArtists: previousPlan.resolvedArtists,
      candidatePool: previousPlan.candidatePool,
      evidenceRecords: previousPlan.evidenceRecords,
      previousAllocations: previousPlan.allocations,
    });

    // Synchronize any suppliedBrand availability changes from updatedBrief into candidatePool
    this.syncSuppliedBrandUpdates(ctx);

    // If a free-text instruction was entered in the assistant box, translate it into structured Constraint objects
    if (instruction && instruction.trim().length > 0) {
      this.applyInstructionToStructuredConstraints(ctx, instruction.trim());
    }

    if (this.useLlmToolLoop && this.geminiApiKey) {
      try {
        await this.runGeminiToolLoop(ctx, "revision", instruction);
      } catch {
        await this.ensureDeterministicCompletion(ctx, "revision");
      }
    } else {
      await this.ensureDeterministicCompletion(ctx, "revision");
    }

    await this.populateActivationBriefs(ctx);

    return this.buildPlanVersion(ctx, previousPlan.versionNumber + 1);
  }

  /**
   * Executes the bounded state-machine workflow (also serves as the completion guarantee if an LLM tool loop stops early).
   */
  private async ensureDeterministicCompletion(
    ctx: AgentWorkspaceContext,
    mode: "initial" | "revision",
  ): Promise<void> {
    // 1. Resolve any unresolved artists or supplied brands
    const allStageArtists = ctx.brief.stages.flatMap((s) => s.artists);
    const hasUnresolvedArtists = allStageArtists.some(
      (name) => !ctx.resolvedArtists[name],
    );
    const hasUnresolvedSupplied = ctx.brief.suppliedBrands.some(
      (sb) =>
        !ctx.candidatePool.some(
          (b) => b.name.toLowerCase() === sb.name.toLowerCase(),
        ),
    );

    if (
      mode === "initial" ||
      hasUnresolvedArtists ||
      hasUnresolvedSupplied ||
      Object.keys(ctx.resolvedArtists).length === 0
    ) {
      await toolResolveLineup(ctx);
    }

    // 2. Discover up to 3 candidate brands per stage on initial run across all stage artists
    const needsStageDiscovery = ctx.brief.stages.some((stage) => {
      const stageDiscoveredCount = ctx.candidatePool.filter(
        (b) => b.source === "discovered" && b.targetStageIds?.includes(stage.id),
      ).length;
      return stageDiscoveredCount === 0;
    });
    if (mode === "initial" && needsStageDiscovery) {
      const allResolvedArtistIds = ctx.brief.stages
        .flatMap((s) => s.artists)
        .map((name) => ctx.resolvedArtists[name]?.qlooId)
        .filter((id): id is string => Boolean(id));

      await toolDiscoverBrands(ctx, allResolvedArtistIds, undefined);
    }

    // 3. Ensure all stage-targeted candidate brands have been evaluated for each stage's resolved artists
    const needsShortlistEval =
      ctx.evidenceRecords.length === 0 ||
      ctx.brief.stages.some((stage) => {
        const stageArtistIds = stage.artists
          .map((name) => ctx.resolvedArtists[name]?.qlooId)
          .filter((id): id is string => Boolean(id));
        const stageBrandIds = ctx.candidatePool
          .filter(
            (b) =>
              !b.targetStageIds ||
              b.targetStageIds.length === 0 ||
              b.targetStageIds.includes(stage.id),
          )
          .map((b) => b.qlooId);

        return stageArtistIds.some((artistId) =>
          stageBrandIds.some(
            (brandId) =>
              !ctx.evidenceRecords.some(
                (ev) => ev.artistId === artistId && ev.brandId === brandId,
              ),
          ),
        );
      });

    if (needsShortlistEval && ctx.candidatePool.length > 0) {
      await toolEvaluateShortlistFit(ctx);
    }

    // 4. Run the deterministic Phase 2 solver
    if (!ctx.latestPlannerResult) {
      await toolRunPlanner(ctx);
    }

    // 5. Reactive recovery: if any stage is unfilled and we haven't already investigated it, try recovery
    if (ctx.latestPlannerResult) {
      const unfilledStages = ctx.latestPlannerResult.allocations.filter(
        (a) => !a.primarySponsor,
      );

      for (const unfilled of unfilledStages) {
        if (ctx.actionHistory.length >= this.maxSteps) break;
        const alreadyInvestigated = ctx.actionHistory.some(
          (entry) =>
            entry.tool === "investigateUnfilledStage" &&
            entry.inputSummary.includes(unfilled.stageName),
        );
        if (alreadyInvestigated) continue;

        const allowedCats = deriveAllowedCategoriesForStage(
          ctx.brief,
          unfilled.stageId,
          ctx.latestPlannerResult,
        );
        await toolInvestigateUnfilledStage(ctx, unfilled.stageId, allowedCats);
      }
    }
  }

  /**
   * Bounded Gemini tool-calling loop (capped at `this.maxSteps`).
   */
  private async runGeminiToolLoop(
    ctx: AgentWorkspaceContext,
    mode: "initial" | "revision",
    instruction?: string,
  ): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });
    const systemInstruction = [
      "You are the SetFluence Research & Recovery Agent.",
      "Never evaluate mathematical or commercial constraints yourself; always call runPlanner.",
      "For initial plans: always call resolveLineup, discoverBrands (to combine supplied brands with Qloo-discovered brands), evaluateShortlistFit, and runPlanner.",
      "For revisions: call runPlanner first to reuse cached evidence. Only call investigateUnfilledStage if a stage is left unfilled.",
    ].join(" ");

    const userPrompt =
      mode === "initial"
        ? `Generate the initial sponsorship plan for festival "${ctx.brief.name}" (${ctx.brief.stages.length} stages, ${ctx.brief.suppliedBrands.length} supplied brands).`
        : `Revise the sponsorship plan for "${ctx.brief.name}". Current pool size: ${ctx.candidatePool.length}. ${instruction ? `Organizer instruction: "${instruction}"` : ""}`;

    const contents: Array<Record<string, unknown>> = [
      { role: "user", parts: [{ text: userPrompt }] },
    ];

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await ai.models.generateContent({
        model: this.geminiModel,
        contents: contents as never,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: AGENT_FUNCTION_DECLARATIONS }],
          temperature: 0,
        },
      });

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        break;
      }

      const call = functionCalls[0]!;
      const args = (call.args ?? {}) as Record<string, unknown>;
      let toolOutput: unknown;

      if (call.name === "resolveLineup") {
        toolOutput = await toolResolveLineup(ctx);
      } else if (call.name === "discoverBrands") {
        const artistIds = Array.isArray(args.artistIds)
          ? args.artistIds.map(String)
          : [];
        const category =
          typeof args.category === "string" ? args.category : undefined;
        toolOutput = await toolDiscoverBrands(ctx, artistIds, category);
      } else if (call.name === "evaluateShortlistFit") {
        toolOutput = await toolEvaluateShortlistFit(ctx);
      } else if (call.name === "runPlanner") {
        toolOutput = await toolRunPlanner(ctx);
      } else if (call.name === "investigateUnfilledStage") {
        const stageId = String(args.stageId ?? "");
        const allowedCategories = Array.isArray(args.allowedCategories)
          ? args.allowedCategories.map(String)
          : undefined;
        toolOutput = await toolInvestigateUnfilledStage(
          ctx,
          stageId,
          allowedCategories,
        );
      } else {
        break;
      }

      contents.push({
        role: "model",
        parts: [{ functionCall: call }],
      });
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: call.name,
              response: { result: toolOutput },
            },
          },
        ],
      });
    }

    // Ensure any required final step (like runPlanner) completed
    await this.ensureDeterministicCompletion(ctx, mode);
  }

  private syncSuppliedBrandUpdates(ctx: AgentWorkspaceContext): void {
    for (const supplied of ctx.brief.suppliedBrands) {
      const existing = ctx.candidatePool.find(
        (b) => b.name.toLowerCase() === supplied.name.toLowerCase(),
      );
      if (existing) {
        if (supplied.available !== undefined) {
          existing.available = supplied.available;
        }
        if (supplied.category) {
          existing.category = supplied.category;
        }
        if (supplied.organizerFacts) {
          existing.organizerFacts = {
            ...existing.organizerFacts,
            ...supplied.organizerFacts,
          };
        }
      }
    }
  }

  /**
   * Deterministically translates common natural-language revision instructions into structured Constraint objects
   * so the solver enforces them with 100% mathematical precision.
   */
  private applyInstructionToStructuredConstraints(
    ctx: AgentWorkspaceContext,
    instruction: string,
  ): void {
    const lower = instruction.toLowerCase();

    // Check if any candidate brand is mentioned as unavailable
    if (lower.includes("unavailable") || lower.includes("drop") || lower.includes("remove")) {
      for (const brand of ctx.candidatePool) {
        if (lower.includes(brand.name.toLowerCase())) {
          brand.available = false;
          ctx.brief.constraints.push({
            id: `rule-unavail-${brand.qlooId}`,
            type: "availability",
            scope: "festival",
            brandId: brand.qlooId,
            active: true,
            reason: `Marked unavailable via revision instruction: "${instruction}"`,
          });
        }
      }
    }

    // Check if a category ban is requested (e.g. "ban alcohol" or "no energy_drink on stage 2")
    if (lower.includes("ban ") || lower.includes("exclude ") || lower.includes("no ")) {
      const stageMatch = ctx.brief.stages.find(
        (s) =>
          lower.includes(s.id.toLowerCase()) ||
          lower.includes(s.name.toLowerCase()),
      );
      const knownCategories = new Set([
        ...ctx.brief.suppliedBrands.map((b) => b.category),
        ...ctx.candidatePool.map((b) => b.category),
      ]);
      for (const cat of knownCategories) {
        const readableCat = cat.replace(/_/g, " ").toLowerCase();
        if (lower.includes(cat.toLowerCase()) || lower.includes(readableCat)) {
          ctx.brief.constraints.push({
            id: `rule-ban-${cat}-${stageMatch?.id ?? "festival"}`,
            type: "category_ban",
            scope: stageMatch ? "stage" : "festival",
            stageId: stageMatch?.id,
            category: cat,
            active: true,
            reason: `Added via revision instruction: "${instruction}"`,
          });
        }
      }
    }
  }

  /**
   * Populates grounded ActivationBriefs for allocated stages using Qloo cultural tags
   * and deterministic cross-stage trade-off analysis.
   */
  private async populateActivationBriefs(
    ctx: AgentWorkspaceContext,
  ): Promise<void> {
    if (!ctx.latestPlannerResult) return;

    for (const allocation of ctx.latestPlannerResult.allocations) {
      if (!allocation.primarySponsor) continue;
      const stage = ctx.brief.stages.find((s) => s.id === allocation.stageId);
      if (!stage) continue;

      const stageArtistIds = stage.artists
        .map((name) => ctx.resolvedArtists[name]?.qlooId)
        .filter((id): id is string => Boolean(id));

      let touchstones: CrossDomainTouchstone[] = [];
      let culturalTags: string[] = [];

      if (stageArtistIds.length > 0) {
        try {
          touchstones =
            await this.qlooService.getCrossDomainTouchstones(stageArtistIds);
        } catch {
          touchstones = [];
        }

        try {
          culturalTags = await this.qlooService.getCulturalAffinityTags(
            stageArtistIds[0]!,
          );
        } catch {
          culturalTags = [];
        }
      }

      const stageTradeoffSummary = buildStageTradeoffSummary(
        stage,
        allocation,
        ctx.brief.stages,
        ctx.latestPlannerResult.matrix,
      );

      let brief = buildGroundedActivationBrief(
        stage,
        allocation.primarySponsor,
        allocation,
        culturalTags,
        touchstones,
        stageTradeoffSummary,
      );

      if (this.useLlmToolLoop && this.geminiApiKey) {
        try {
          brief = await this.enrichActivationBriefWithGemini(
            brief,
            stage,
            allocation.primarySponsor,
            allocation,
          );
        } catch {
          // Keep deterministic grounded activation brief on any LLM error
        }
      }

      allocation.activationBrief = brief;
    }
  }

  private async enrichActivationBriefWithGemini(
    baseBrief: ActivationBrief,
    stage: StageBrief,
    sponsor: CandidateBrand,
    allocation: StageAllocation,
  ): Promise<ActivationBrief> {
    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });
    const format = baseBrief.formatCompliance;
    const tagList = baseBrief.culturalTagsUsed.join(", ");
    const tierLabel = format.stageTier
      ? format.stageTier.replace(/_/g, " ")
      : "stage";

    const prompt = [
      `Create a suggestive, brainstorm-style festival activation spec sheet for sponsor "${sponsor.name}" (category: ${sponsor.category}) on stage "${stage.name}" (${stage.genreLabel}, artists: ${stage.artists.join(", ")}).`,
      `Physical zone envelope: Format="${format.formatName}", Stage Tier="${tierLabel}", Footprint="${format.requiredSpaceFootprint}".`,
      `Qloo Music & Lifestyle Tags: ${tagList || stage.genreLabel}.`,
      `Relative Shortlist Fit: ${allocation.relativeFitScore?.toFixed(3) ?? "N/A"} pts across ${allocation.supportedArtistsCount}/${allocation.totalStageArtistsCount} artists.`,
      `Rules: Frame all concepts suggestively ("Could explore...", "Consider hosting...", "Potential concept:") rather than stating "This will". Provide 3 distinct fanActivityOptions (Option 1: Interactive Product/Craft Experience, Option 2: Social/Content Moment, Option 3: Stage-Side Utility/Hospitality). Never use percentage signs (%) for fit scores. Never invent dollar amounts.`,
    ].join("\n");

    const response = await ai.models.generateContent({
      model: this.geminiModel,
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            experienceTitle: { type: Type.STRING },
            visitorExperience: { type: Type.STRING },
            fanActivityOptions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            sponsorRole: { type: Type.STRING },
            culturalRationale: { type: Type.STRING },
          },
          required: [
            "experienceTitle",
            "visitorExperience",
            "fanActivityOptions",
            "sponsorRole",
            "culturalRationale",
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text ?? "{}") as Partial<ActivationBrief>;
    if (
      parsed.experienceTitle &&
      parsed.visitorExperience &&
      parsed.sponsorRole &&
      parsed.culturalRationale
    ) {
      return {
        ...baseBrief,
        experienceTitle: parsed.experienceTitle,
        visitorExperience: parsed.visitorExperience,
        fanActivityOptions:
          Array.isArray(parsed.fanActivityOptions) &&
          parsed.fanActivityOptions.length > 0
            ? parsed.fanActivityOptions.slice(0, 3)
            : baseBrief.fanActivityOptions,
        sponsorRole: parsed.sponsorRole,
        culturalRationale: parsed.culturalRationale,
      };
    }
    return baseBrief;
  }

  private buildPlanVersion(
    ctx: AgentWorkspaceContext,
    versionNumber: number,
  ): PlanVersion {
    const plannerResult = ctx.latestPlannerResult ?? {
      allocations: [],
      matrix: [],
      unresolvedConflicts: [],
      diffLog: [],
    };

    const filledCount = plannerResult.allocations.filter((a) =>
      Boolean(a.primarySponsor),
    ).length;

    const agentSummary =
      plannerResult.unresolvedConflicts.length > 0
        ? `Allocated ${filledCount}/${ctx.brief.stages.length} stages. Action required: ${plannerResult.unresolvedConflicts.join(" ")}`
        : filledCount < ctx.brief.stages.length
          ? `Allocated ${filledCount}/${ctx.brief.stages.length} stages. ${ctx.brief.stages.length - filledCount} stage(s) remain unfilled under current constraints.`
          : `Successfully allocated all ${filledCount}/${ctx.brief.stages.length} stages using ${ctx.candidatePool.length} evaluated candidate brands.`;

    return {
      versionId: `plan-v${versionNumber}-${Date.now()}`,
      versionNumber,
      createdAt: new Date().toISOString(),
      briefSnapshot: structuredClone(ctx.brief),
      resolvedArtists: structuredClone(ctx.resolvedArtists),
      candidatePool: structuredClone(ctx.candidatePool),
      evidenceRecords: structuredClone(ctx.evidenceRecords),
      matrix: plannerResult.matrix,
      allocations: plannerResult.allocations,
      unresolvedConflicts: plannerResult.unresolvedConflicts,
      diffLog: plannerResult.diffLog,
      actionHistory: ctx.actionHistory,
      agentSummary,
    };
  }
}

function buildStageTradeoffSummary(
  stage: StageBrief,
  allocation: StageAllocation,
  allStages: StageBrief[],
  matrix: StageBrandEvaluation[],
): string {
  const sponsor = allocation.primarySponsor;
  if (!sponsor) return "No feasible sponsor available under current hard rules.";

  const primaryPts = allocation.relativeFitScore ?? 0;
  const alt = allocation.alternativeSponsor;
  const altEval = alt
    ? matrix.find(
        (m) => m.stageId === stage.id && m.brandId === alt.qlooId,
      )
    : undefined;
  const altPts = altEval?.relativeFitScore ?? null;

  const runnerUpClause =
    alt && altPts !== null
      ? `Outscored runner-up ${alt.name} (${altPts.toFixed(3)} pts) by +${Math.max(0, primaryPts - altPts).toFixed(3)} pts on ${stage.name}`
      : `Top eligible shortlist candidate on ${stage.name} (${primaryPts.toFixed(3)} pts)`;

  const otherStageComparisons = allStages
    .filter((s) => s.id !== stage.id)
    .map((otherStage) => {
      const ev = matrix.find(
        (m) => m.stageId === otherStage.id && m.brandId === sponsor.qlooId,
      );
      if (!ev || ev.relativeFitScore === null) {
        return `${otherStage.name}: stage-specific shortlist`;
      }
      if (!ev.eligible) {
        return `${otherStage.name}: ${ev.relativeFitScore.toFixed(3)} pts (rule-blocked)`;
      }
      return `${otherStage.name}: ${ev.relativeFitScore.toFixed(3)} pts`;
    });

  return `${runnerUpClause}. Cross-stage comparison for ${sponsor.name}: ${stage.name} (${primaryPts.toFixed(3)} pts) vs. ${otherStageComparisons.join(", ")}.`;
}

function formatTierReadable(tier?: string): string {
  if (tier === "headliner_arena") return "Main Headliner Arena (25k+ cap)";
  if (tier === "secondary_stage") return "Secondary Stage (8k–15k cap)";
  if (tier === "intimate_tent") return "Intimate Tent & Lounge (2k–5k cap)";
  return "Stage Zone";
}

function deriveCategoryExperienceConcept(
  sponsorName: string,
  category: string,
  stage: StageBrief,
  formatName: string,
  footprint: string,
  stageTier?: string,
): {
  hookNoun: string;
  visitorExperience: string;
  fanActivityOptions: string[];
  sponsorRole: string;
} {
  const cat = category.toLowerCase();
  const tierText = formatTierReadable(stageTier);
  const leadArtist = stage.artists[0] ?? stage.genreLabel;

  if (cat.includes("footwear") || cat.includes("apparel")) {
    return {
      hookNoun: `Custom Archive & Wearable Concept`,
      visitorExperience: `Suggested direction: Could explore a ${footprint}-footprint customization and styling activation scaled for ${stage.name} (${tierText}).`,
      fanActivityOptions: [
        `Interactive Craft: Could host a live patch, lace, or heat-press customization counter inspired by ${stage.genreLabel} aesthetics.`,
        `Social & Content Moment: Consider a lookbook portrait booth where fans style limited ${sponsorName} pieces before ${leadArtist}'s set.`,
        `Stage-Side Utility: Potential express locker & wearable refresh station positioned along the ${stage.name} entry concourse.`,
      ],
      sponsorRole: `Potential lead ${category.replace(/_/g, " ")} partner anchoring ${stage.name}'s ${formatName}.`,
    };
  }
  if (cat.includes("energy") || cat.includes("beverage") || cat.includes("drink")) {
    return {
      hookNoun: `Kinetic Recharge Bar & Terrace Concept`,
      visitorExperience: `Suggested direction: Consider a ${footprint}-footprint refreshment and crowd recharge zone tailored to ${stage.name} (${tierText}).`,
      fanActivityOptions: [
        `Interactive Tasting: Could feature stage-themed signature pours or zero-proof functional flights paired with ${stage.genreLabel} set times.`,
        `Social & Content Moment: Potential BPM-reactive lighting canopy or elevated viewing deck overlooking ${stage.name}.`,
        `Stage-Side Utility: Consider an express hydration, misting, and rapid phone-charging bar between headliner sets.`,
      ],
      sponsorRole: `Potential ${category.replace(/_/g, " ")} partner powering ${stage.name}'s ${formatName}.`,
    };
  }
  if (cat.includes("stream") || cat.includes("audio") || cat.includes("electronic")) {
    return {
      hookNoun: `Hi-Fi Stem Listening & Creator Concept`,
      visitorExperience: `Suggested direction: Could build a ${footprint}-footprint audio & fan-creator studio adjacent to ${stage.name} (${tierText}).`,
      fanActivityOptions: [
        `Interactive Audio Lab: Consider hands-on stem remixing pods or spatial-audio listening stations featuring tracks from ${stage.artists.slice(0, 2).join(" & ")}.`,
        `Social & Content Moment: Could offer a backstage-style soundcheck reel booth with instant digital sharing for fans.`,
        `Stage-Side Utility: Potential shaded acoustic lounge with live set-time schedules and curated stage playlists.`,
      ],
      sponsorRole: `Potential ${category.replace(/_/g, " ")} partner hosting ${stage.name}'s ${formatName}.`,
    };
  }
  if (cat.includes("eyewear") || cat.includes("fashion")) {
    return {
      hookNoun: `Golden-Hour Optical & Portrait Concept`,
      visitorExperience: `Suggested direction: Could curate a ${footprint}-footprint styling and portrait installation beside ${stage.name} (${tierText}).`,
      fanActivityOptions: [
        `Interactive Styling: Consider a festival frame-fitting bar and UV lens customization station matched to ${stage.genreLabel} visuals.`,
        `Social & Content Moment: Could host a golden-hour analog film portrait studio framed toward ${stage.name}.`,
        `Stage-Side Utility: Potential complimentary lens-cleaning, sun-care, and shaded mirror lounge for attendees.`,
      ],
      sponsorRole: `Potential ${category.replace(/_/g, " ")} partner curating ${stage.name}'s ${formatName}.`,
    };
  }
  return {
    hookNoun: `${formatName} Concept`,
    visitorExperience: `Suggested direction: Could explore a ${footprint}-footprint interactive brand zone scaled for ${stage.name} (${tierText}).`,
    fanActivityOptions: [
      `Interactive Experience: Could host a hands-on ${sponsorName} product trial or co-creation station tied to ${stage.genreLabel} culture.`,
      `Social & Content Moment: Consider an artist-inspired photo or visual installation celebrating ${stage.name}'s lineup.`,
      `Stage-Side Utility: Potential fan hospitality lounge and recharge point scaled to a ${footprint} footprint.`,
    ],
    sponsorRole: `Potential primary ${category.replace(/_/g, " ")} partner for ${stage.name}'s ${formatName}.`,
  };
}

function buildGroundedActivationBrief(
  stage: StageBrief,
  sponsor: CandidateBrand,
  allocation: StageAllocation,
  culturalTags: string[],
  touchstones: CrossDomainTouchstone[],
  stageTradeoffSummary: string,
): ActivationBrief {
  const defaultTier =
    stage.id === "stage-1"
      ? ("headliner_arena" as const)
      : stage.id === "stage-2"
        ? ("secondary_stage" as const)
        : ("intimate_tent" as const);

  const format = stage.activationFormat ?? {
    id: "fmt-default",
    name: "Flagship Experience Pavilion",
    requiredSpaceFootprint: "medium" as const,
    noiseLevelCeiling: "moderate" as const,
    stageTier: defaultTier,
  };

  const effectiveTier = format.stageTier ?? defaultTier;

  const tagTouchstones = touchstones
    .filter((t) => t.domain === "tag")
    .map((t) => t.name);

  const tagsToCite = [
    ...new Set([...culturalTags, ...tagTouchstones]),
  ].slice(0, 5);

  const supportingArtistNames = allocation.artistEvidence
    .filter((ev) => ev.status === "ok" && ev.ordinalPoints !== null)
    .map((ev) => `${ev.artistName} (#${ev.ordinalRank}/${ev.shortlistSize})`);

  const concept = deriveCategoryExperienceConcept(
    sponsor.name,
    sponsor.category,
    stage,
    format.name,
    format.requiredSpaceFootprint,
    effectiveTier,
  );

  return {
    experienceTitle: `${sponsor.name} × ${stage.name}: ${concept.hookNoun}`,
    visitorExperience: concept.visitorExperience,
    fanActivityOptions: concept.fanActivityOptions,
    sponsorRole: concept.sponsorRole,
    culturalRationale: `Ranked #1 on ${stage.name} (${allocation.relativeFitScore?.toFixed(3) ?? "N/A"} pts across ${supportingArtistNames.join(", ") || "resolved lineup artists"}).`,
    groundingEvidenceIds: allocation.artistEvidence.map((ev) => ev.id),
    culturalTagsUsed: tagsToCite,
    crossDomainTouchstones: touchstones,
    stageTradeoffSummary,
    formatCompliance: {
      compliant: true,
      formatName: format.name,
      requiredSpaceFootprint: format.requiredSpaceFootprint,
      noiseLevelCeiling: format.noiseLevelCeiling,
      stageTier: effectiveTier,
      notes: `Fits ${stage.name}'s ${format.requiredSpaceFootprint} footprint and ${formatTierReadable(effectiveTier)} profile.`,
    },
    openQuestions: [allocation.unansweredCommercialQuestion],
  };
}
