import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CandidateBrand,
  EvidenceRecord,
  FestivalBrief,
  QlooEntityType,
  ResolvedEntity,
} from "@setfluence/shared";
import { AgentOrchestrator } from "./agent/orchestrator.ts";
import { buildServer } from "./index.ts";
import { computeOrdinalRanking, QlooService } from "./services/qloo.service.ts";

class ServerTestQlooService extends QlooService {
  constructor() {
    super({ apiKey: "test-key", baseUrl: "https://hackathon.api.qloo.com" });
  }

  override async searchEntity(
    query: string,
    type: QlooEntityType = "urn:entity:artist",
  ): Promise<ResolvedEntity[]> {
    return [
      {
        inputName: query,
        canonicalName: query,
        qlooId: `id-${query.toLowerCase().replace(/\s+/g, "-")}`,
        entityType: type,
        status: "resolved",
        matchConfidence: 1.0,
        popularity: 0.99,
        alternatives: [],
        resolvedAt: "2026-10-16T16:00:00.000Z",
      },
    ];
  }

  override async discoverCandidateBrands(): Promise<CandidateBrand[]> {
    return [
      {
        qlooId: "id-ray-ban",
        name: "Ray-Ban",
        category: "eyewear",
        source: "discovered",
        available: true,
        organizerFacts: { budgetStatus: "unknown" },
      },
      {
        qlooId: "id-spotify",
        name: "Spotify",
        category: "streaming",
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
    const ranked = brands.map((b, idx) => ({
      id: b.qlooId,
      affinity: Number((0.95 - idx * 0.05).toFixed(2)),
    }));
    const ordinal = computeOrdinalRanking(ranked);

    return brands.map((b, idx) => ({
      id: `ev:${artist.qlooId}:${b.qlooId}`,
      artistId: artist.qlooId,
      artistName: artist.name,
      brandId: b.qlooId,
      brandName: b.name,
      operation: "evaluate_shortlist",
      queryParameters: {
        "filter.type": "urn:entity:brand",
        "signal.interests.entities": artist.qlooId,
      },
      timestamp: "2026-10-16T16:00:00.000Z",
      rawScore: Number((0.95 - idx * 0.05).toFixed(2)),
      ordinalRank: ordinal.get(b.qlooId)?.rank ?? null,
      ordinalPoints: ordinal.get(b.qlooId)?.points ?? null,
      shortlistSize: brands.length,
      coverageRatio: 1.0,
      status: "ok",
      sourceType: "live",
    }));
  }

  override async getCulturalAffinityTags(): Promise<string[]> {
    return ["indie-film", "vinyl-culture"];
  }
}

describe("Phase 4 End-to-End Fastify API & Static SPA Server", () => {
  it("Serves /api/health, /api/plans/generate, /api/plans/revise, and compiled SPA index.html", async () => {
    const qloo = new ServerTestQlooService();
    const orchestrator = new AgentOrchestrator({
      qlooService: qloo,
      useLlmToolLoop: false,
    });
    const app = buildServer(qloo, orchestrator);

    // 1. Health check
    const healthRes = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.json().status, "ok");

    // 2. Generate initial plan
    const brief: FestivalBrief = {
      id: "brief-e2e",
      name: "Horizon E2E",
      location: "Austin, TX",
      stages: [
        {
          id: "stage-1",
          name: "Main Stage",
          genreLabel: "Indie",
          artists: ["Arctic Monkeys", "Tame Impala"],
        },
        {
          id: "stage-2",
          name: "Dance Arena",
          genreLabel: "Electronic",
          artists: ["Calvin Harris", "Disclosure"],
        },
        {
          id: "stage-3",
          name: "Block Party",
          genreLabel: "Hip-Hop",
          artists: ["Kendrick Lamar", "SZA"],
        },
      ],
      preferredCategories: ["footwear", "apparel", "energy_drink", "eyewear"],
      suppliedBrands: [
        { name: "Converse", category: "footwear" },
        { name: "Nike", category: "apparel" },
        { name: "Red Bull", category: "energy_drink" },
        { name: "Samsung", category: "consumer_electronics" },
      ],
      constraints: [],
    };

    const genRes = await app.inject({
      method: "POST",
      url: "/api/plans/generate",
      payload: { brief },
    });
    assert.equal(genRes.statusCode, 200);
    const v1 = genRes.json().plan;
    assert.equal(v1.versionNumber, 1);
    assert.equal(v1.allocations.length, 3);
    assert.ok(v1.allocations[0].primarySponsor);

    // 3. Revise plan via API
    const revRes = await app.inject({
      method: "POST",
      url: "/api/plans/revise",
      payload: {
        previousPlan: v1,
        updatedBrief: v1.briefSnapshot,
        instruction: "Mark Converse unavailable",
      },
    });
    assert.equal(revRes.statusCode, 200);
    const v2 = revRes.json().plan;
    assert.equal(v2.versionNumber, 2);
    assert.notEqual(v2.allocations[0].primarySponsor?.name, "Converse");

    // 4. Static SPA index.html serving from frontend/dist
    const spaRes = await app.inject({ method: "GET", url: "/" });
    assert.equal(spaRes.statusCode, 200);
    assert.match(spaRes.headers["content-type"] ?? "", /text\/html/);
    assert.match(spaRes.body, /<div id="root"><\/div>/);

    await app.close();
  });
});
