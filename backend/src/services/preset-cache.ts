import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FestivalBrief, PlanVersion } from "@setfluence/shared";
import type { AgentOrchestrator } from "../agent/orchestrator.ts";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const RENDER_SECRET_CACHE_PATH = "/etc/secrets/preset-plans.json";
const DEFAULT_CACHE_PATH = resolve(CURRENT_DIR, "../../../.cache/preset-plans.json");

export const DEFAULT_PRESET_BRIEFS: FestivalBrief[] = [
  {
    id: "preset-horizon-2026",
    name: "Horizon Sound Festival",
    location: "Austin, TX",
    stages: [
      {
        id: "stage-1",
        name: "Main Stage",
        genreLabel: "Indie / Alt Rock",
        artists: ["Arctic Monkeys", "Tame Impala", "The 1975"],
        activationFormat: {
          id: "fmt-pavilion",
          name: "Flagship Experience Pavilion",
          requiredSpaceFootprint: "large",
          noiseLevelCeiling: "moderate",
          stageTier: "headliner_arena",
        },
      },
      {
        id: "stage-2",
        name: "Dance Arena",
        genreLabel: "Electronic / Dance",
        artists: ["Calvin Harris", "David Guetta", "Disclosure"],
        activationFormat: {
          id: "fmt-immersion",
          name: "High-Energy Immersion Zone",
          requiredSpaceFootprint: "medium",
          noiseLevelCeiling: "loud",
          stageTier: "secondary_stage",
        },
      },
      {
        id: "stage-3",
        name: "Block Party",
        genreLabel: "Hip-hop / R&B",
        artists: ["Kendrick Lamar", "Travis Scott", "SZA"],
        activationFormat: {
          id: "fmt-studio",
          name: "Intimate Creator & Listening Studio",
          requiredSpaceFootprint: "compact",
          noiseLevelCeiling: "quiet",
          stageTier: "intimate_tent",
        },
      },
    ],
    suppliedBrands: [
      { name: "Converse", category: "footwear", available: true },
      { name: "Nike", category: "apparel", available: true },
      { name: "Adidas", category: "apparel", available: true },
      { name: "Red Bull", category: "energy_drink", available: true },
      { name: "Spotify", category: "streaming", available: true },
    ],
    constraints: [
      {
        id: "excl-apparel-festival",
        type: "category_exclusivity",
        scope: "festival",
        category: "apparel",
        active: true,
        reason: "At most one primary apparel sponsor across the festival.",
      },
    ],
  },
  {
    id: "preset-neon-pulse",
    name: "Neon Pulse Electronic Weekender",
    location: "Detroit, MI",
    stages: [
      {
        id: "stage-1",
        name: "Cyber Dome",
        genreLabel: "Progressive & Synth",
        artists: ["Disclosure", "Tame Impala", "Calvin Harris"],
        activationFormat: {
          id: "fmt-cyber",
          name: "Audio-Visual Synth Pavilion",
          requiredSpaceFootprint: "large",
          noiseLevelCeiling: "loud",
          stageTier: "headliner_arena",
        },
      },
      {
        id: "stage-2",
        name: "Warehouse 09",
        genreLabel: "Big Room & Club",
        artists: ["David Guetta", "Travis Scott", "Calvin Harris"],
        activationFormat: {
          id: "fmt-bunker",
          name: "Sub-Frequency Recharge Bunker",
          requiredSpaceFootprint: "medium",
          noiseLevelCeiling: "loud",
          stageTier: "secondary_stage",
        },
      },
      {
        id: "stage-3",
        name: "Vinyl Sanctuary",
        genreLabel: "Alt & R&B Chillout",
        artists: ["SZA", "The 1975", "Arctic Monkeys"],
        activationFormat: {
          id: "fmt-sanctuary",
          name: "Analog Vinyl Listening Lounge",
          requiredSpaceFootprint: "compact",
          noiseLevelCeiling: "quiet",
          stageTier: "intimate_tent",
        },
      },
    ],
    suppliedBrands: [
      { name: "Red Bull", category: "energy_drink", available: true },
      { name: "Monster Energy", category: "energy_drink", available: true },
      { name: "Spotify", category: "streaming", available: true },
      { name: "Samsung", category: "consumer_electronics", available: true },
      { name: "Ray-Ban", category: "eyewear", available: true },
    ],
    constraints: [
      {
        id: "excl-energy-festival",
        type: "category_exclusivity",
        scope: "festival",
        category: "energy_drink",
        active: true,
        reason: "At most one primary energy_drink sponsor across the festival.",
      },
    ],
  },
  {
    id: "preset-conflict-stress",
    name: "Apex Multi-Constraint Showcase",
    location: "Chicago, IL",
    stages: [
      {
        id: "stage-1",
        name: "Main Stage",
        genreLabel: "Indie / Alt Rock",
        artists: ["Arctic Monkeys", "Tame Impala", "The 1975"],
        activationFormat: {
          id: "fmt-pavilion",
          name: "Flagship Experience Pavilion",
          requiredSpaceFootprint: "large",
          noiseLevelCeiling: "moderate",
          stageTier: "headliner_arena",
        },
      },
      {
        id: "stage-2",
        name: "Dance Arena",
        genreLabel: "Electronic / Dance",
        artists: ["Calvin Harris", "David Guetta", "Disclosure"],
        activationFormat: {
          id: "fmt-immersion",
          name: "High-Energy Immersion Zone",
          requiredSpaceFootprint: "medium",
          noiseLevelCeiling: "loud",
          stageTier: "secondary_stage",
        },
      },
      {
        id: "stage-3",
        name: "Block Party",
        genreLabel: "Hip-hop / R&B",
        artists: ["Kendrick Lamar", "Travis Scott", "SZA"],
        activationFormat: {
          id: "fmt-studio",
          name: "Intimate Creator & Listening Studio",
          requiredSpaceFootprint: "compact",
          noiseLevelCeiling: "quiet",
          stageTier: "intimate_tent",
        },
      },
    ],
    suppliedBrands: [
      { name: "Nike", category: "apparel", available: true },
      { name: "Adidas", category: "apparel", available: true },
      { name: "Converse", category: "footwear", available: true },
      { name: "Red Bull", category: "energy_drink", available: true },
      { name: "Monster Energy", category: "energy_drink", available: true },
    ],
    constraints: [
      {
        id: "excl-apparel-festival",
        type: "category_exclusivity",
        scope: "festival",
        category: "apparel",
        active: true,
        reason: "At most one primary apparel sponsor across the festival.",
      },
      {
        id: "ban-energy-stage-1",
        type: "category_ban",
        scope: "stage",
        stageId: "stage-1",
        category: "energy_drink",
        active: true,
        reason: "Banned category energy_drink on Main Stage.",
      },
    ],
  },
];

/**
 * Computes a deterministic SHA-256 fingerprint of a FestivalBrief so that:
 * - Unmodified presets match their pre-warmed live Qloo PlanVersion in <5ms
 * - Any edit to stages, artists, supplied brands, or commercial rules produces a new hash and runs the live backend
 */
export function computeBriefFingerprint(brief: FestivalBrief): string {
  const canonical = {
    scoringVersion: "raw-qloo-v2",
    stages: brief.stages.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      genreLabel: s.genreLabel.trim(),
      artists: s.artists.map((a) => a.trim().toLowerCase()),
      footprint: s.activationFormat?.requiredSpaceFootprint ?? "medium",
      tier: s.activationFormat?.stageTier ?? "headliner_arena",
    })),
    suppliedBrands: brief.suppliedBrands.map((b) => ({
      name: b.name.trim().toLowerCase(),
      category: b.category.trim().toLowerCase(),
      available: b.available ?? true,
      footprints: b.organizerFacts?.supportedSpaceFootprints ?? null,
    })),
    constraints: brief.constraints
      .filter((c) => c.active)
      .map((c) => ({
        type: c.type,
        scope: c.scope,
        stageId: c.stageId ?? null,
        brandId: c.brandId?.trim().toLowerCase() ?? null,
        category: c.category?.trim().toLowerCase() ?? null,
      })),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 24);
}

export class PresetPlanCache {
  private readonly store = new Map<string, PlanVersion>();
  private readonly inFlight = new Map<string, Promise<PlanVersion>>();
  private readonly diskPath: string | null;

  constructor(options: { persistToDisk?: boolean; diskPath?: string } = {}) {
    this.diskPath =
      options.persistToDisk === false
        ? null
        : (options.diskPath ?? DEFAULT_CACHE_PATH);

    if (this.diskPath) {
      if (this.diskPath === DEFAULT_CACHE_PATH) {
        this.loadFileIntoStore(RENDER_SECRET_CACHE_PATH);
      }
      this.loadFileIntoStore(this.diskPath);
    }
  }

  get(brief: FestivalBrief): PlanVersion | null {
    const key = computeBriefFingerprint(brief);
    const cached = this.store.get(key);
    return cached ? structuredClone(cached) : null;
  }

  set(brief: FestivalBrief, plan: PlanVersion): void {
    const key = computeBriefFingerprint(brief);
    this.store.set(key, structuredClone(plan));
    this.saveToDisk();
  }

  async getOrGenerate(
    brief: FestivalBrief,
    orchestrator: AgentOrchestrator,
    forceRefresh = false,
  ): Promise<{ plan: PlanVersion; fromPresetCache: boolean }> {
    if (!forceRefresh) {
      const cached = this.get(brief);
      if (cached) {
        return { plan: cached, fromPresetCache: true };
      }
    }

    const key = computeBriefFingerprint(brief);
    if (!forceRefresh) {
      const existingPromise = this.inFlight.get(key);
      if (existingPromise) {
        const plan = await existingPromise;
        return { plan: structuredClone(plan), fromPresetCache: true };
      }
    }

    const generationPromise = orchestrator
      .generateInitialPlan(structuredClone(brief))
      .then((plan) => {
        this.set(brief, plan);
        return plan;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, generationPromise);
    const plan = await generationPromise;
    return { plan: structuredClone(plan), fromPresetCache: false };
  }

  async warmPresetsInBackground(orchestrator: AgentOrchestrator): Promise<void> {
    for (const presetBrief of DEFAULT_PRESET_BRIEFS) {
      if (this.get(presetBrief)) continue;
      try {
        await this.getOrGenerate(presetBrief, orchestrator);
      } catch {
        // Non-fatal background warm-up; will retry on explicit request
      }
    }
  }

  private loadFileIntoStore(filePath: string): void {
    if (!filePath || !existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, PlanVersion>;
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v === "object" && Array.isArray(v.allocations)) {
            this.store.set(k, v);
          }
        }
      }
    } catch {
      // Ignore corrupted disk cache
    }
  }

  private saveToDisk(): void {
    if (!this.diskPath) return;
    try {
      mkdirSync(dirname(this.diskPath), { recursive: true });
      const serialized: Record<string, PlanVersion> = {};
      for (const [k, v] of this.store.entries()) {
        serialized[k] = v;
      }
      writeFileSync(this.diskPath, JSON.stringify(serialized), "utf-8");
    } catch {
      // Non-fatal
    }
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  const cache = new PresetPlanCache({ persistToDisk: true });
  const uncachedCount = DEFAULT_PRESET_BRIEFS.filter((b) => !cache.get(b)).length;

  if (uncachedCount === 0) {
    console.log("[preset-cache] All 3 default presets are already cached in .cache/preset-plans.json.");
  } else if (!process.env.QLOO_API_KEY) {
    console.log("[preset-cache] QLOO_API_KEY not set during build; skipping build-time preset warm-up.");
  } else {
    console.log(`[preset-cache] Baking ${uncachedCount} preset plan(s) into .cache/preset-plans.json for instant startup...`);
    const [{ QlooService }, { AgentOrchestrator }] = await Promise.all([
      import("./qloo.service.ts"),
      import("../agent/orchestrator.ts"),
    ]);
    const qlooService = new QlooService();
    const orchestrator = new AgentOrchestrator({ qlooService });
    await cache.warmPresetsInBackground(orchestrator);
    console.log("[preset-cache] Build-time preset warm-up complete.");
  }
}
