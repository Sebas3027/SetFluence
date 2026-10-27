import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CandidateBrand,
  EvidenceRecord,
  FestivalBrief,
} from "@setfluence/shared";
import { runPlanner } from "./planner.ts";

function makeBrand(
  qlooId: string,
  name: string,
  category: string,
  overrides: Partial<CandidateBrand> = {},
): CandidateBrand {
  return {
    qlooId,
    name,
    category,
    source: "supplied",
    available: true,
    organizerFacts: {
      budgetStatus: "unknown",
    },
    ...overrides,
  };
}

function makeEvidence(
  artistId: string,
  artistName: string,
  brandId: string,
  brandName: string,
  ordinalPoints: number | null,
  rawScore: number | null = ordinalPoints,
): EvidenceRecord {
  return {
    id: `ev:${artistId}:${brandId}`,
    artistId,
    artistName,
    brandId,
    brandName,
    operation: "evaluate_shortlist",
    queryParameters: {},
    timestamp: "2026-10-15T18:00:00.000Z",
    rawScore,
    ordinalRank: ordinalPoints !== null ? 1 : null,
    ordinalPoints,
    shortlistSize: 6,
    coverageRatio: ordinalPoints !== null ? 1 : 0,
    status: ordinalPoints !== null ? "ok" : "missing",
    sourceType: "synthetic_fixture",
  };
}

function makeBaseFixture() {
  const resolvedArtistIdsByName: Record<string, string | null> = {
    "Arctic Monkeys": "art-am",
    "Tame Impala": "art-ti",
    "Calvin Harris": "art-ch",
    Disclosure: "art-dc",
    "Kendrick Lamar": "art-kl",
    SZA: "art-sza",
  };

  const brands = {
    converse: makeBrand("br-converse", "Converse", "footwear"),
    nike: makeBrand("br-nike", "Nike", "apparel"),
    adidas: makeBrand("br-adidas", "Adidas", "apparel"),
    redbull: makeBrand("br-redbull", "Red Bull", "energy_drink"),
    rayban: makeBrand("br-rayban", "Ray-Ban", "eyewear"),
    heineken: makeBrand("br-heineken", "Heineken", "alcohol"),
  };

  const candidatePool: CandidateBrand[] = Object.values(brands);

  const brief: FestivalBrief = {
    id: "brief-test",
    name: "Test Festival",
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
    suppliedBrands: [],
    constraints: [],
  };

  // Stage 1: Converse (0.95), Nike (0.70), Ray-Ban (0.65), Red Bull (0.60), Adidas (0.55), Heineken (0.20)
  // Stage 2: Nike (0.95), Red Bull (0.85), Adidas (0.75), Converse (0.60), Ray-Ban (0.50), Heineken (0.30)
  // Stage 3: Nike (0.90), Adidas (0.88), Ray-Ban (0.80), Converse (0.75), Red Bull (0.40), Heineken (0.10)
  const stageArtistScores: Array<{
    artists: Array<[string, string]>;
    scores: Array<[CandidateBrand, number]>;
  }> = [
    {
      artists: [
        ["art-am", "Arctic Monkeys"],
        ["art-ti", "Tame Impala"],
      ],
      scores: [
        [brands.converse, 0.95],
        [brands.nike, 0.7],
        [brands.rayban, 0.65],
        [brands.redbull, 0.6],
        [brands.adidas, 0.55],
        [brands.heineken, 0.2],
      ],
    },
    {
      artists: [
        ["art-ch", "Calvin Harris"],
        ["art-dc", "Disclosure"],
      ],
      scores: [
        [brands.nike, 0.95],
        [brands.redbull, 0.85],
        [brands.adidas, 0.75],
        [brands.converse, 0.6],
        [brands.rayban, 0.5],
        [brands.heineken, 0.3],
      ],
    },
    {
      artists: [
        ["art-kl", "Kendrick Lamar"],
        ["art-sza", "SZA"],
      ],
      scores: [
        [brands.nike, 0.9],
        [brands.adidas, 0.88],
        [brands.rayban, 0.8],
        [brands.converse, 0.75],
        [brands.redbull, 0.4],
        [brands.heineken, 0.1],
      ],
    },
  ];

  const evidenceRecords: EvidenceRecord[] = [];
  for (const group of stageArtistScores) {
    for (const [artistId, artistName] of group.artists) {
      for (const [brand, pts] of group.scores) {
        evidenceRecords.push(
          makeEvidence(artistId, artistName, brand.qlooId, brand.name, pts),
        );
      }
    }
  }

  return { brief, brands, candidatePool, resolvedArtistIdsByName, evidenceRecords };
}

describe("Phase 2 Deterministic Constraint Solver (runPlanner)", () => {
  it("1. Finds optimal 3-stage assignment without assigning the same brand to two stages", () => {
    const { brief, candidatePool, resolvedArtistIdsByName, evidenceRecords } =
      makeBaseFixture();

    const result = runPlanner({
      brief,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    });

    assert.equal(result.unresolvedConflicts.length, 0);
    // Nike is #1 on both Stage 2 (0.95) and Stage 3 (0.90), while Adidas is #2 on Stage 3 (0.88).
    // Optimal sum: Stage 1 = Converse (0.95) + Stage 2 = Nike (0.95) + Stage 3 = Adidas (0.88) = 2.78
    assert.equal(result.allocations[0]?.primarySponsor?.name, "Converse");
    assert.equal(result.allocations[1]?.primarySponsor?.name, "Nike");
    assert.equal(result.allocations[2]?.primarySponsor?.name, "Adidas");
  });

  it("2. Enforces festival-wide category exclusivity and picks a festival-feasible alternative", () => {
    const { brief, candidatePool, resolvedArtistIdsByName, evidenceRecords } =
      makeBaseFixture();

    brief.constraints.push({
      id: "excl-apparel",
      type: "category_exclusivity",
      scope: "festival",
      category: "apparel",
      active: true,
    });

    const result = runPlanner({
      brief,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    });

    // With apparel exclusive across the festival, Nike (apparel) and Adidas (apparel) cannot both be selected.
    // Stage 2 = Nike (0.95) + Stage 3 = Ray-Ban (0.80) = 1.75 vs Stage 2 = Red Bull (0.85) + Stage 3 = Nike (0.90) = 1.75
    // Either way, at most one apparel brand is primary across the 3 stages:
    const apparelPrimaries = result.allocations.filter(
      (a) => a.primarySponsor?.category === "apparel",
    );
    assert.equal(apparelPrimaries.length, 1);

    // Furthermore, on the stage that DOES NOT have an apparel primary, the alternativeSponsor
    // cannot be an apparel brand because the other stage already holds the apparel exclusivity slot!
    for (const alloc of result.allocations) {
      if (alloc.primarySponsor?.category !== "apparel") {
        assert.notEqual(
          alloc.alternativeSponsor?.category,
          "apparel",
          `Alternative on ${alloc.stageName} must not violate festival-wide apparel exclusivity`,
        );
      }
    }
  });

  it("3. Detects locked placement conflicts instead of silently overriding hard rules", () => {
    const {
      brief,
      brands,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    } = makeBaseFixture();

    // Lock Heineken (alcohol) to Stage 1 AND ban alcohol across the festival
    brief.constraints.push(
      {
        id: "lock-stage1-heineken",
        type: "locked_placement",
        scope: "stage",
        stageId: "stage-1",
        brandId: brands.heineken.qlooId,
        active: true,
      },
      {
        id: "ban-alcohol",
        type: "category_ban",
        scope: "festival",
        category: "alcohol",
        active: true,
      },
    );

    const result = runPlanner({
      brief,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    });

    // Must report explicit conflict in unresolvedConflicts
    assert.ok(result.unresolvedConflicts.length > 0);
    assert.match(result.unresolvedConflicts[0]!, /Heineken.*prohibited/i);

    // Stage 1 must NOT silently allocate Heineken or bypass the lock with Converse; it remains unfilled (null) with blockingReasons
    assert.equal(result.allocations[0]?.primarySponsor, null);
    assert.ok((result.allocations[0]?.blockingReasons.length ?? 0) > 0);
  });

  it("4. Enforces stage ActivationFormat noise and space footprint constraints", () => {
    const {
      brief,
      brands,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    } = makeBaseFixture();

    // Stage 1 requires a quiet compact lounge
    brief.stages[0]!.activationFormat = {
      id: "fmt-quiet-lounge",
      name: "Acoustic Lounge",
      requiredSpaceFootprint: "compact",
      noiseLevelCeiling: "quiet",
    };

    // Converse proposes a loud activation -> should be blocked on Stage 1
    brands.converse.organizerFacts = {
      budgetStatus: "confirmed",
      operatingNoiseLevel: "loud",
    };

    const result = runPlanner({
      brief,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    });

    assert.notEqual(result.allocations[0]?.primarySponsor?.name, "Converse");
    const converseStage1Cell = result.matrix.find(
      (m) => m.stageId === "stage-1" && m.brandId === brands.converse.qlooId,
    );
    assert.equal(converseStage1Cell?.eligible, false);
    assert.ok(
      converseStage1Cell?.blockingReasons.some((r) =>
        r.includes("exceeds stage"),
      ),
    );
  });

  it("5. Breaks ties on revision by minimizing churn against previousAllocations and logs diffs", () => {
    const {
      brief,
      brands,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    } = makeBaseFixture();

    // Make Ray-Ban tie with Converse on Stage 1 (0.95), and make Red Bull #2 on Stage 3 (0.85)
    // so Stage 1 choice (Converse vs Ray-Ban) is a true festival-wide tie (0.95 + 0.95 + 0.85 = 2.75)
    for (const ev of evidenceRecords) {
      if (
        (ev.artistId === "art-am" || ev.artistId === "art-ti") &&
        ev.brandId === brands.rayban.qlooId
      ) {
        ev.ordinalPoints = 0.95;
      }
      if (
        (ev.artistId === "art-kl" || ev.artistId === "art-sza") &&
        ev.brandId === brands.redbull.qlooId
      ) {
        ev.ordinalPoints = 0.85;
      }
    }

    // Suppose a previous plan had Ray-Ban on Stage 1, Nike on Stage 2, Adidas on Stage 3
    const initialRun = runPlanner({
      brief,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
    });
    // Force previous allocation on Stage 1 to Ray-Ban
    const previousAllocations = initialRun.allocations.map((a) =>
      a.stageId === "stage-1" ? { ...a, primarySponsor: brands.rayban } : a,
    );

    // Mark Adidas unavailable on Stage 3 and re-run
    brands.adidas.available = false;

    const revisedRun = runPlanner({
      brief,
      candidatePool,
      resolvedArtistIdsByName,
      evidenceRecords,
      previousAllocations,
    });

    // Stage 1 should preserve Ray-Ban (minimal churn tie-breaker) even though Converse comes first in array order
    assert.equal(revisedRun.allocations[0]?.primarySponsor?.name, "Ray-Ban");
    // And diffLog should record the change on Stage 3 where Adidas became unavailable
    const stage3Diff = revisedRun.diffLog.find(
      (d) => d.stageId === "stage-3" && d.field === "primarySponsor",
    );
    assert.ok(stage3Diff);
    assert.equal(stage3Diff.previousValue, "Adidas");
    assert.match(stage3Diff.reason, /unavailable/i);
  });
});
