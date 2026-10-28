import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CandidateBrand,
  CrossDomainTouchstone,
  EvidenceRecord,
  FestivalBrief,
  QlooEntityType,
  ResolvedEntity,
} from "@setfluence/shared";
import { computeOrdinalRanking, QlooService } from "../services/qloo.service.ts";
import { runControlledBenchmark } from "./benchmark.ts";
import { AgentOrchestrator } from "./orchestrator.ts";

class StubQlooService extends QlooService {
  discoverCalls = 0;
  shortlistEvalCalls = 0;

  private readonly rawAffinitiesByArtist: Record<string, Record<string, number>> = {
    "art-am": {
      "br-converse": 0.94,
      "br-redbull": 0.85,
      "br-nike": 0.88,
      "br-spotify": 0.82,
      "br-rayban": 0.9,
      "br-samsung": 0.78,
      "br-pioneer": 0.81,
    },
    "art-ch": {
      "br-redbull": 0.96,
      "br-nike": 0.91,
      "br-converse": 0.8,
      "br-spotify": 0.89,
      "br-rayban": 0.84,
      "br-samsung": 0.86,
      "br-pioneer": 0.95,
    },
    "art-kl": {
      "br-nike": 0.98,
      "br-converse": 0.91,
      "br-redbull": 0.84,
      "br-spotify": 0.88,
      "br-rayban": 0.92,
      "br-samsung": 0.83,
      "br-pioneer": 0.79,
    },
  };

  constructor() {
    super({ apiKey: "test-key", baseUrl: "https://hackathon.api.qloo.com" });
  }

  override async searchEntity(
    query: string,
    type: QlooEntityType = "urn:entity:artist",
  ): Promise<ResolvedEntity[]> {
    const map: Record<string, { id: string; name: string }> = {
      "arctic monkeys": { id: "art-am", name: "Arctic Monkeys" },
      "calvin harris": { id: "art-ch", name: "Calvin Harris" },
      "kendrick lamar": { id: "art-kl", name: "Kendrick Lamar" },
      converse: { id: "br-converse", name: "Converse" },
      "red bull": { id: "br-redbull", name: "Red Bull" },
      nike: { id: "br-nike", name: "Nike" },
      spotify: { id: "br-spotify", name: "Spotify" },
    };

    const hit = map[query.trim().toLowerCase()];
    return [
      {
        inputName: query,
        canonicalName: hit?.name ?? query,
        qlooId: hit?.id ?? `id-${query.toLowerCase().replace(/\s+/g, "-")}`,
        entityType: type,
        status: "resolved",
        matchConfidence: 1.0,
        popularity: 0.99,
        alternatives: [],
        resolvedAt: "2026-10-15T20:00:00.000Z",
      },
    ];
  }

  override async discoverCandidateBrands(
    _artistIds: string | string[],
    category?: string,
  ): Promise<CandidateBrand[]> {
    this.discoverCalls++;
    if (category === "audio_gear") {
      return [
        {
          qlooId: "br-pioneer",
          name: "Pioneer DJ",
          category: "audio_gear",
          source: "discovered",
          available: true,
          organizerFacts: { budgetStatus: "unknown" },
        },
      ];
    }

    return [
      {
        qlooId: "br-rayban",
        name: "Ray-Ban",
        category: "eyewear",
        source: "discovered",
        available: true,
        organizerFacts: { budgetStatus: "unknown" },
      },
      {
        qlooId: "br-samsung",
        name: "Samsung",
        category: "consumer_electronics",
        source: "discovered",
        available: true,
        organizerFacts: { budgetStatus: "unknown" },
      },
    ];
  }

  override async evaluateShortlistWithEvidence(
    artist: { qlooId: string; name: string },
    brands: Array<{ qlooId: string; name: string }>,
  ): Promise<EvidenceRecord[]> {
    this.shortlistEvalCalls++;
    const artistScores = this.rawAffinitiesByArtist[artist.qlooId] ?? {};
    const ranked = brands
      .map((b) => ({
        id: b.qlooId,
        name: b.name,
        affinity: artistScores[b.qlooId] ?? 0.5,
      }))
      .sort((a, b) => b.affinity - a.affinity);

    const ordinal = computeOrdinalRanking(ranked);

    return brands.map((b) => {
      const ord = ordinal.get(b.qlooId);
      return {
        id: `ev:${artist.qlooId}:${b.qlooId}`,
        artistId: artist.qlooId,
        artistName: artist.name,
        brandId: b.qlooId,
        brandName: b.name,
        operation: "evaluate_shortlist",
        queryParameters: {},
        timestamp: "2026-10-15T20:00:00.000Z",
        rawScore: artistScores[b.qlooId] ?? 0.5,
        ordinalRank: ord?.rank ?? null,
        ordinalPoints: ord?.points ?? null,
        shortlistSize: brands.length,
        coverageRatio: 1.0,
        status: "ok",
        sourceType: "synthetic_fixture",
      };
    });
  }

  override async getCulturalAffinityTags(_artistId: string): Promise<string[]> {
    return ["indie-cinema", "analog-photography", "streetwear"];
  }

  override async getCrossDomainTouchstones(
    _artistIds: string[],
  ): Promise<CrossDomainTouchstone[]> {
    return [
      {
        id: "mov-submarine",
        name: "Submarine",
        domain: "movie",
        qlooEntityType: "urn:entity:movie",
        affinityScore: 0.91,
        sourceEndpoint: "/v2/insights",
      },
      {
        id: "game-skate3",
        name: "Skate 3",
        domain: "video_game",
        qlooEntityType: "urn:entity:video_game",
        affinityScore: 0.86,
        sourceEndpoint: "/v2/insights",
      },
      {
        id: "tag-indie-cinema",
        name: "indie-cinema",
        domain: "tag",
        qlooEntityType: "urn:tag:genre",
        affinityScore: 0.89,
        sourceEndpoint: "/v2/tags",
      },
    ];
  }
}

function makeTestBrief(): FestivalBrief {
  return {
    id: "brief-agent-test",
    name: "Horizon Test Festival",
    location: "Austin, TX",
    stages: [
      {
        id: "stage-1",
        name: "Main Stage",
        genreLabel: "Indie Rock",
        artists: ["Arctic Monkeys"],
        activationFormat: {
          id: "fmt-1",
          name: "Flagship Experience Pavilion",
          requiredSpaceFootprint: "large",
          noiseLevelCeiling: "moderate",
        },
      },
      {
        id: "stage-2",
        name: "Dance Arena",
        genreLabel: "Electronic",
        artists: ["Calvin Harris"],
        activationFormat: {
          id: "fmt-2",
          name: "High-Energy Immersion Zone",
          requiredSpaceFootprint: "medium",
          noiseLevelCeiling: "loud",
        },
      },
      {
        id: "stage-3",
        name: "Block Party",
        genreLabel: "Hip-Hop",
        artists: ["Kendrick Lamar"],
        activationFormat: {
          id: "fmt-3",
          name: "Intimate Creator & Listening Studio",
          requiredSpaceFootprint: "compact",
          noiseLevelCeiling: "quiet",
        },
      },
    ],
    suppliedBrands: [
      { name: "Converse", category: "footwear" },
      { name: "Red Bull", category: "energy_drink" },
      { name: "Nike", category: "apparel" },
      { name: "Spotify", category: "streaming" },
    ],
    constraints: [],
  };
}

describe("Phase 3 Bounded Agent Research & Recovery Loop", () => {
  it("1. Initial planning resolves lineup, discovers brands, scores shortlist, allocates 3 stages, and synthesizes cross-domain activation briefs", async () => {
    const qloo = new StubQlooService();
    const orchestrator = new AgentOrchestrator({
      qlooService: qloo,
      useLlmToolLoop: false,
    });

    const plan = await orchestrator.generateInitialPlan(makeTestBrief());

    assert.equal(plan.versionNumber, 1);
    assert.equal(plan.allocations.length, 3);
    assert.equal(plan.allocations[0]?.primarySponsor?.name, "Converse");
    assert.equal(plan.allocations[1]?.primarySponsor?.name, "Red Bull");
    assert.equal(plan.allocations[2]?.primarySponsor?.name, "Nike");

    // Verify grounded activation brief, cross-domain touchstones, and stage trade-off summary
    const brief0 = plan.allocations[0]?.activationBrief;
    assert.ok(brief0);
    assert.ok(brief0.culturalTagsUsed.includes("indie-cinema"));
    assert.ok((brief0.crossDomainTouchstones?.length ?? 0) >= 2);
    assert.equal(brief0.crossDomainTouchstones?.[0]?.name, "Submarine");
    assert.ok(brief0.stageTradeoffSummary?.includes("Main Stage"));
    assert.ok(!brief0.stageTradeoffSummary?.includes("%"));

    const toolsCalled = plan.actionHistory.map((a) => a.tool);
    assert.deepEqual(toolsCalled, [
      "resolveLineup",
      "discoverBrands",
      "evaluateShortlistFit",
      "runPlanner",
    ]);
  });

  it("2. Fast revision reuses existing evidence without unnecessary discovery when a fallback already exists", async () => {
    const qloo = new StubQlooService();
    const orchestrator = new AgentOrchestrator({
      qlooService: qloo,
      useLlmToolLoop: false,
    });

    const v1 = await orchestrator.generateInitialPlan(makeTestBrief());
    const discoverCallsBeforeRevision = qloo.discoverCalls;

    // Revise via natural-language instruction marking Red Bull unavailable
    const v2 = await orchestrator.revisePlan(
      v1,
      v1.briefSnapshot,
      "Mark Red Bull unavailable for Dance Arena",
    );

    assert.equal(v2.versionNumber, 2);
    assert.notEqual(v2.allocations[1]?.primarySponsor?.name, "Red Bull");
    assert.ok(v2.allocations[1]?.primarySponsor);
    // Should NOT have needed extra discovery calls since Spotify/Samsung/Ray-Ban were already in pool
    assert.equal(qloo.discoverCalls, discoverCallsBeforeRevision);
    assert.deepEqual(
      v2.actionHistory.map((a) => a.tool),
      ["runPlanner"],
    );
    assert.ok(
      v2.diffLog.some(
        (d) => d.stageId === "stage-2" && d.previousValue === "Red Bull",
      ),
    );
  });

  it("3. Reactive recovery invokes investigateUnfilledStage to discover a compliant brand when a stage becomes unfilled", async () => {
    const qloo = new StubQlooService();
    const orchestrator = new AgentOrchestrator({
      qlooService: qloo,
      useLlmToolLoop: false,
    });

    const v1 = await orchestrator.generateInitialPlan(makeTestBrief());

    // Ban all existing non-allocated categories on Stage 2 and mark Red Bull unavailable,
    // leaving only "audio_gear" allowed on Stage 2 (which is not in the pool yet!)
    const updatedBrief = structuredClone(v1.briefSnapshot);
    updatedBrief.constraints.push(
      {
        id: "unavail-rb",
        type: "availability",
        scope: "festival",
        brandId: "br-redbull",
        active: true,
      },
      {
        id: "ban-streaming-s2",
        type: "category_ban",
        scope: "stage",
        stageId: "stage-2",
        category: "streaming",
        active: true,
      },
      {
        id: "ban-eyewear-s2",
        type: "category_ban",
        scope: "stage",
        stageId: "stage-2",
        category: "eyewear",
        active: true,
      },
      {
        id: "ban-ce-s2",
        type: "category_ban",
        scope: "stage",
        stageId: "stage-2",
        category: "consumer_electronics",
        active: true,
      },
      {
        id: "lock-s1-converse",
        type: "locked_placement",
        scope: "stage",
        stageId: "stage-1",
        brandId: "br-converse",
        active: true,
      },
      {
        id: "lock-s3-nike",
        type: "locked_placement",
        scope: "stage",
        stageId: "stage-3",
        brandId: "br-nike",
        active: true,
      },
    );

    const v2 = await orchestrator.revisePlan(v1, updatedBrief);

    // First runPlanner leaves Stage 2 unfilled -> agent calls investigateUnfilledStage -> discovers Pioneer DJ (audio_gear) -> fills Stage 2!
    assert.deepEqual(
      v2.actionHistory.map((a) => a.tool),
      ["runPlanner", "investigateUnfilledStage"],
    );
    assert.equal(v2.allocations[1]?.primarySponsor?.name, "Pioneer DJ");
    // Verify Stage 2 shortlist size reflects Stage 2's stage-specific pool and all fit scores are positive
    assert.ok(
      v2.allocations[1]?.artistEvidence.every(
        (r) => r.shortlistSize >= 4 && (r.ordinalPoints ?? 0) > 0.5,
      ),
    );
  });

  it("4. Surfaces unresolvable hard lock conflicts honestly without overriding rules", async () => {
    const qloo = new StubQlooService();
    const orchestrator = new AgentOrchestrator({
      qlooService: qloo,
      useLlmToolLoop: false,
    });

    const v1 = await orchestrator.generateInitialPlan(makeTestBrief());
    const updatedBrief = structuredClone(v1.briefSnapshot);

    // Lock Red Bull to Stage 2 AND ban energy_drink across the festival
    updatedBrief.constraints.push(
      {
        id: "lock-s2-rb",
        type: "locked_placement",
        scope: "stage",
        stageId: "stage-2",
        brandId: "br-redbull",
        active: true,
      },
      {
        id: "ban-energy",
        type: "category_ban",
        scope: "festival",
        category: "energy_drink",
        active: true,
      },
    );

    const v2 = await orchestrator.revisePlan(v1, updatedBrief);

    assert.ok(v2.unresolvedConflicts.length > 0);
    assert.equal(v2.allocations[1]?.primarySponsor, null);
  });

  it("5. Controlled LLM vs. Qloo benchmark compares both conditions through the identical deterministic solver", async () => {
    const qloo = new StubQlooService();
    const orchestrator = new AgentOrchestrator({
      qlooService: qloo,
      useLlmToolLoop: false,
    });

    const v1 = await orchestrator.generateInitialPlan(makeTestBrief());
    const benchmark = await runControlledBenchmark(v1, {
      useLiveGemini: false,
    });

    assert.equal(benchmark.stageComparisons.length, 3);
    assert.equal(benchmark.metrics.qlooTraceableClaimsPct, 100);
    assert.equal(benchmark.metrics.ungroundedTraceableClaimsPct, 0);
    assert.equal(benchmark.metrics.solverConstraintViolationsBoth, 0);
    assert.ok(benchmark.metrics.qlooStageSpecificDiscoveriesCount > 0);
  });
});

