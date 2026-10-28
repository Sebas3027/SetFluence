import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  CandidateBrand,
  CrossDomainTouchstone,
  CrossDomainTouchstoneType,
  CulturalTagEvidence,
  EntityMatchStatus,
  EvidenceRecord,
  QlooEntityType,
  ResolvedEntity,
} from "@setfluence/shared";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIR, "../../..");

/**
 * Documented parameters for GET /v2/insights when filter.type=urn:entity:brand.
 * Qloo silently ignores unsupported parameters on 200 OK responses, so we strictly
 * validate every brand Insights query against this schema prior to dispatch.
 */
export const BrandInsightsParamsSchema = z
  .object({
    "filter.type": z.literal("urn:entity:brand"),
    "bias.trends": z.string().optional(),
    "filter.exclude.entities": z.string().optional(),
    "operator.exclude.tags": z.string().optional(),
    "filter.exclude.tags": z.string().optional(),
    "filter.external.exists": z.string().optional(),
    "operator.filter.external.exists": z.string().optional(),
    "filter.parents.types": z.string().optional(),
    "filter.popularity.min": z.number().min(0).max(1).optional(),
    "filter.popularity.max": z.number().min(0).max(1).optional(),
    "filter.results.entities": z.string().optional(),
    "filter.results.entities.query": z.string().optional(),
    "filter.tags": z.string().optional(),
    "operator.filter.tags": z.enum(["and", "or"]).optional(),
    "signal.demographics.age": z.string().optional(),
    "signal.demographics.audiences": z.string().optional(),
    "signal.demographics.audiences.weight": z.number().optional(),
    "signal.interests.entities": z.string().optional(),
    "signal.demographics.gender": z.string().optional(),
    "signal.interests.tags": z.string().optional(),
    offset: z.number().int().min(0).optional(),
    take: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type BrandInsightsParams = z.infer<typeof BrandInsightsParamsSchema>;

export const CrossDomainInsightsParamsSchema = z
  .object({
    "filter.type": z.enum([
      "urn:entity:movie",
      "urn:entity:tv_show",
      "urn:entity:video_game",
      "urn:entity:book",
    ]),
    "signal.interests.entities": z.string().min(1),
    take: z.number().int().min(1).max(25).optional(),
  })
  .strict();

export const SearchParamsSchema = z
  .object({
    query: z.string().min(1),
    types: z.string().optional(),
    take: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

export const TagsSearchParamsSchema = z
  .object({
    "filter.query": z.string().min(1).optional(),
    "filter.parents.types": z.string().optional(),
    "filter.tag.types": z.string().optional(),
    take: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export class QlooApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly details?: unknown;

  constructor(message: string, status: number, path: string, details?: unknown) {
    super(message);
    this.name = "QlooApiError";
    this.status = status;
    this.path = path;
    this.details = details;
  }
}

export interface CacheEntry<T = unknown> {
  signature: string;
  cachedAt: string;
  payload: T;
}

export interface QlooServiceOptions {
  baseUrl?: string;
  apiKey?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
  cacheTtlMs?: number;
}

interface RawExtractedEntity {
  id: string;
  name: string;
  types: string[];
  popularity: number | null;
  affinity: number | null;
  tags: Array<{ id: string; name: string; type: string }>;
  raw: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const toFiniteNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const normalizeEntityName = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function inferBrandCategoryFromQlooTags(
  tags: Array<{ id: string; name: string }>,
  explicitCategory?: string,
): string {
  if (explicitCategory && explicitCategory.trim().length > 0) {
    return explicitCategory.trim().toLowerCase();
  }
  const combined = tags.map((t) => t.name.toLowerCase()).join(" ");
  if (/\b(footwear|shoe|sneaker|boot)\b/.test(combined)) return "footwear";
  if (/\b(apparel|clothing|fashion|streetwear|sportswear|activewear|luxury)\b/.test(combined)) {
    return "apparel";
  }
  if (/\b(energy drink|energy)\b/.test(combined)) return "energy_drink";
  if (/\b(alcohol|beer|spirits|wine|liquor|brewery)\b/.test(combined)) return "alcohol";
  if (/\b(beverage|drink|soda|coffee|tea|water)\b/.test(combined)) return "beverage";
  if (/\b(streaming|music service|podcast)\b/.test(combined)) return "streaming";
  if (/\b(eyewear|sunglasses|glasses|optical)\b/.test(combined)) return "eyewear";
  if (/\b(audio|headphone|speaker|synthesizer|dj|sound|instrument)\b/.test(combined)) {
    return "audio_gear";
  }
  if (/\b(electronics|tech|software|computer|phone|mobile|gaming|console)\b/.test(combined)) {
    return "consumer_electronics";
  }
  if (/\b(outdoor|camping|hiking|adventure)\b/.test(combined)) return "outdoor";
  if (/\b(automotive|car|vehicle|motor)\b/.test(combined)) return "automotive";

  const firstTag = tags[0]?.name
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return firstTag || "lifestyle";
}

/**
 * Computes 1-based shortlist ranks (#1..#k) and assigns Qloo's raw affinity score directly
 * (falling back to positional rank only if an entity returned without a numeric affinity).
 * Candidates not returned by Qloo remain absent from the map (treated as unknown, never zero).
 */
export function computeOrdinalRanking(
  ranked: Array<{ id: string; affinity: number | null }>,
): Map<string, { rank: number; points: number }> {
  const out = new Map<string, { rank: number; points: number }>();
  const k = ranked.length;
  if (k === 0) return out;
  if (k === 1) {
    const raw = ranked[0]!.affinity;
    const singleScore =
      raw !== null && raw >= 0
        ? Number(Math.min(1, raw).toFixed(4))
        : 1.0;
    out.set(ranked[0]!.id, { rank: 1, points: singleScore });
    return out;
  }

  let i = 0;
  while (i < k) {
    let j = i;
    const currentAffinity = ranked[i]!.affinity;
    while (
      j + 1 < k &&
      currentAffinity !== null &&
      ranked[j + 1]!.affinity === currentAffinity
    ) {
      j++;
    }
    const avgPos = (i + j) / 2;
    const rawOrFallback =
      currentAffinity !== null && currentAffinity >= 0
        ? Math.min(1, currentAffinity)
        : 1 - avgPos / (k - 1);
    const points = Number(rawOrFallback.toFixed(4));
    const rank = i + 1;
    for (let p = i; p <= j; p++) {
      out.set(ranked[p]!.id, { rank, points });
    }
    i = j + 1;
  }
  return out;
}

export function resolveQlooEnv(rootDir = REPO_ROOT): { baseUrl: string; apiKey: string } {
  const envPath = resolve(rootDir, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  const apiKey = (process.env.QLOO_API_KEY ?? process.env.API_Key ?? "").trim();
  const baseUrl = (
    process.env.QLOO_BASE_URL ??
    process.env.QLOO_URL ??
    "https://hackathon.api.qloo.com"
  )
    .trim()
    .replace(/\/+$/, "");

  return { baseUrl, apiKey };
}

export class QlooService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: QlooServiceOptions = {}) {
    const env = resolveQlooEnv();
    this.baseUrl = (options.baseUrl ?? env.baseUrl).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? env.apiKey;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60 * 1000; // 30 minutes default
  }

  /**
   * Resolves an entity name via GET /search and classifies match confidence
   * ("resolved" | "ambiguous" | "fuzzy" | "unresolved").
   */
  async searchEntity(
    query: string,
    type: QlooEntityType = "urn:entity:artist",
  ): Promise<ResolvedEntity[]> {
    const validated = SearchParamsSchema.parse({
      query: query.trim(),
      types: type,
      take: 5,
    });

    const { payload, cachedAt } = await this.requestGet("/search", validated);
    const entities = this.extractEntities(payload);

    if (entities.length === 0) {
      return [
        {
          inputName: query,
          canonicalName: null,
          qlooId: null,
          entityType: type,
          status: "unresolved",
          matchConfidence: 0,
          popularity: null,
          alternatives: [],
          resolvedAt: cachedAt,
        },
      ];
    }

    const normalizedQuery = normalizeEntityName(query);
    const exactMatches = entities.filter(
      (e) => normalizeEntityName(e.name) === normalizedQuery,
    );

    let status: EntityMatchStatus;
    let primary: RawExtractedEntity;
    let confidence: number;

    if (exactMatches.length === 1) {
      status = "resolved";
      primary = exactMatches[0]!;
      confidence = 1.0;
    } else if (exactMatches.length > 1) {
      status = "ambiguous";
      primary = [...exactMatches].sort(
        (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
      )[0]!;
      confidence = 0.85;
    } else {
      status = "fuzzy";
      primary = entities[0]!;
      confidence = 0.65;
    }

    const alternatives = entities
      .filter((e) => e.id !== primary.id)
      .slice(0, 4)
      .map((e) => ({
        qlooId: e.id,
        name: e.name,
        popularity: e.popularity,
      }));

    return [
      {
        inputName: query,
        canonicalName: primary.name,
        qlooId: primary.id,
        entityType: primary.types[0] ?? type,
        status,
        matchConfidence: confidence,
        popularity: primary.popularity,
        alternatives,
        resolvedAt: cachedAt,
        rawMetadata: primary.raw,
      },
    ];
  }

  /**
   * Open candidate discovery: queries GET /v2/insights for brand entities
   * given one or more artist signals (e.g., all 3 artists on a stage) and optional category tag filter.
   */
  async discoverCandidateBrands(
    artistIds: string | string[],
    category?: string,
  ): Promise<CandidateBrand[]> {
    const signalEntities = Array.isArray(artistIds)
      ? artistIds.filter(Boolean).join(",")
      : artistIds.trim();

    if (!signalEntities) return [];

    let filterTagId: string | undefined;
    if (category && category.trim().length > 0) {
      const matchedTags = await this.lookupTagsByKeyword(category.trim(), "urn:entity:brand");
      if (matchedTags.length > 0) {
        filterTagId = matchedTags[0]!.tagId;
      }
    }

    const rawParams: BrandInsightsParams = {
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": signalEntities,
      ...(filterTagId ? { "filter.tags": filterTagId } : {}),
      take: 25,
    };

    const validatedParams = BrandInsightsParamsSchema.parse(rawParams);
    const { payload } = await this.requestGet("/v2/insights", validatedParams);
    const entities = this.extractEntities(payload);

    return entities.map((entity) => ({
      qlooId: entity.id,
      name: entity.name,
      category: inferBrandCategoryFromQlooTags(entity.tags, category),
      source: "discovered",
      available: true,
      popularity: entity.popularity,
      organizerFacts: {
        budgetStatus: "unknown",
      },
    }));
  }

  /**
   * Fixed shortlist evaluation: evaluates a common shortlist of brand IDs against a single artist signal.
   * Returns a map of brandId -> ordinal points in [0.0, 1.0]. Missing candidates are omitted (never assumed 0).
   */
  async evaluateCandidates(
    artistId: string,
    brandIds: string[],
  ): Promise<Map<string, number>> {
    if (brandIds.length === 0) return new Map();

    const validatedParams = BrandInsightsParamsSchema.parse({
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": artistId,
      "filter.results.entities": brandIds.join(","),
      take: Math.min(brandIds.length, 100),
    });

    const { payload } = await this.requestGet("/v2/insights", validatedParams);
    const allowedSet = new Set(brandIds);
    const returned = this.extractEntities(payload).filter((e) => allowedSet.has(e.id));

    const ordinalMap = computeOrdinalRanking(
      returned.map((e) => ({ id: e.id, affinity: e.affinity })),
    );

    const scores = new Map<string, number>();
    for (const [id, entry] of ordinalMap.entries()) {
      scores.set(id, entry.points);
    }
    return scores;
  }

  /**
   * Evaluates a fixed brand shortlist for an artist and returns full inspectable EvidenceRecords
   * (including rawScore, ordinalRank, ordinalPoints, request timestamp, and cache status).
   */
  async evaluateShortlistWithEvidence(
    artist: { qlooId: string; name: string },
    brands: Array<{ qlooId: string; name: string }>,
    coverageRatio = 1.0,
  ): Promise<EvidenceRecord[]> {
    if (brands.length === 0) return [];

    const brandIds = brands.map((b) => b.qlooId);
    const validatedParams = BrandInsightsParamsSchema.parse({
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": artist.qlooId,
      "filter.results.entities": brandIds.join(","),
      take: Math.min(brandIds.length, 100),
    });

    const { payload, cachedAt, fromCache } = await this.requestGet(
      "/v2/insights",
      validatedParams,
    );
    const allowedSet = new Set(brandIds);
    const returned = this.extractEntities(payload).filter((e) => allowedSet.has(e.id));
    const returnedById = new Map(returned.map((e) => [e.id, e]));
    const ordinalById = computeOrdinalRanking(
      returned.map((e) => ({ id: e.id, affinity: e.affinity })),
    );

    const queryParameters: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(validatedParams)) {
      if (v !== undefined) queryParameters[k] = v;
    }

    return brands.map((brand) => {
      const entity = returnedById.get(brand.qlooId);
      const ordinal = ordinalById.get(brand.qlooId);
      return {
        id: `ev:${artist.qlooId}:${brand.qlooId}`,
        artistId: artist.qlooId,
        artistName: artist.name,
        brandId: brand.qlooId,
        brandName: brand.name,
        operation: "evaluate_shortlist",
        queryParameters,
        timestamp: cachedAt,
        rawScore: entity?.affinity ?? null,
        ordinalRank: ordinal?.rank ?? null,
        ordinalPoints: ordinal?.points ?? null,
        shortlistSize: brands.length,
        coverageRatio,
        status: entity ? "ok" : "missing",
        sourceType: fromCache ? "cached_live" : "live",
      };
    });
  }

  /**
   * Retrieves cultural affinity tags for an artist using both:
   * 1. GET /v2/insights (extracting tags from top brand/cultural recommendations for the artist signal)
   * 2. GET /v2/tags (searching & validating tag metadata for discovered tag keywords)
   */
  async getCulturalAffinityTags(artistId: string): Promise<string[]> {
    const detailed = await this.getDetailedCulturalAffinityTags(artistId);
    return detailed.map((t) => t.name);
  }

  async getDetailedCulturalAffinityTags(artistId: string): Promise<CulturalTagEvidence[]> {
    const validatedParams = BrandInsightsParamsSchema.parse({
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": artistId,
      take: 10,
    });

    const { payload, cachedAt } = await this.requestGet("/v2/insights", validatedParams);
    const entities = this.extractEntities(payload);

    const collected = new Map<string, CulturalTagEvidence>();
    for (const entity of entities) {
      for (const tag of entity.tags) {
        if (!collected.has(tag.id)) {
          collected.set(tag.id, {
            tagId: tag.id,
            name: tag.name,
            tagType: tag.type,
            affinity: entity.affinity,
            sourceEndpoint: "/v2/insights",
            artistId,
            timestamp: cachedAt,
          });
        }
      }
    }

    // Supplement with /v2/tags lookup on the top discovered tag name (if any) to verify canonical tag metadata
    const firstTag = [...collected.values()][0];
    if (firstTag) {
      const verifiedTags = await this.lookupTagsByKeyword(firstTag.name, "urn:entity:brand");
      for (const vt of verifiedTags.slice(0, 5)) {
        if (!collected.has(vt.tagId)) {
          collected.set(vt.tagId, {
            ...vt,
            artistId,
          });
        }
      }
    }

    return [...collected.values()].slice(0, 15);
  }

  /**
   * Queries GET /v2/insights across cross-domain entity types (movie, video_game, book)
   * plus cultural tags for a stage's resolved artist signals.
   */
  async getCrossDomainTouchstones(
    artistIds: string[],
  ): Promise<CrossDomainTouchstone[]> {
    const cleanIds = [...new Set(artistIds.map((id) => id.trim()).filter(Boolean))];
    if (cleanIds.length === 0) return [];

    const signalEntities = cleanIds.slice(0, 5).join(",");
    const domainSpecs: Array<{
      filterType:
        | "urn:entity:movie"
        | "urn:entity:video_game"
        | "urn:entity:book";
      domain: CrossDomainTouchstoneType;
      take: number;
    }> = [
      { filterType: "urn:entity:movie", domain: "movie", take: 3 },
      { filterType: "urn:entity:video_game", domain: "video_game", take: 2 },
      { filterType: "urn:entity:book", domain: "book", take: 2 },
    ];

    const touchstones: CrossDomainTouchstone[] = [];
    const seenNames = new Set<string>();

    await Promise.all(
      domainSpecs.map(async (spec) => {
        try {
          const validated = CrossDomainInsightsParamsSchema.parse({
            "filter.type": spec.filterType,
            "signal.interests.entities": signalEntities,
            take: spec.take,
          });
          const { payload } = await this.requestGet("/v2/insights", validated);
          const entities = this.extractEntities(payload);
          for (const ent of entities.slice(0, 2)) {
            const norm = normalizeEntityName(ent.name);
            if (!norm || seenNames.has(norm)) continue;
            seenNames.add(norm);
            touchstones.push({
              id: ent.id,
              name: ent.name,
              domain: spec.domain,
              qlooEntityType: spec.filterType,
              affinityScore: ent.affinity,
              sourceEndpoint: "/v2/insights",
            });
          }
        } catch {
          // Non-fatal: continue collecting remaining cross-domain signals
        }
      }),
    );

    // Also attach top cultural tags from the lead artist so tags appear with provenance alongside cross-domain entities
    try {
      const tagEvidence = await this.getDetailedCulturalAffinityTags(cleanIds[0]!);
      for (const tag of tagEvidence.slice(0, 3)) {
        const norm = normalizeEntityName(tag.name);
        if (!norm || seenNames.has(norm)) continue;
        seenNames.add(norm);
        touchstones.push({
          id: tag.tagId,
          name: tag.name,
          domain: "tag",
          qlooEntityType: tag.tagType,
          affinityScore: tag.affinity,
          sourceEndpoint: tag.sourceEndpoint,
        });
      }
    } catch {
      // Non-fatal
    }

    return touchstones.slice(0, 6);
  }

  /**
   * Queries GET /v2/tags to resolve freeform category/interest keywords into canonical Qloo tag IDs.
   */
  async lookupTagsByKeyword(
    keyword: string,
    parentEntityType?: QlooEntityType,
  ): Promise<CulturalTagEvidence[]> {
    const validated = TagsSearchParamsSchema.parse({
      "filter.query": keyword.trim(),
      ...(parentEntityType ? { "filter.parents.types": parentEntityType } : {}),
      take: 10,
    });

    const { payload, cachedAt } = await this.requestGet("/v2/tags", validated);
    if (!isRecord(payload)) return [];

    const results = isRecord(payload.results)
      ? payload.results.tags
      : Array.isArray(payload.results)
        ? payload.results
        : payload.tags;

    if (!Array.isArray(results)) return [];

    return results
      .filter(isRecord)
      .map((t) => ({
        tagId: String(t.id ?? t.tag_id ?? ""),
        name: String(t.name ?? t.value ?? ""),
        tagType: String(t.type ?? t.subtype ?? "urn:tag"),
        affinity: null,
        sourceEndpoint: "/v2/tags" as const,
        artistId: "",
        timestamp: cachedAt,
      }))
      .filter((t) => t.tagId.length > 0 && t.name.length > 0);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private buildCacheSignature(
    path: string,
    params: Record<string, string | number | undefined>,
  ): string {
    const sortedEntries = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const query = sortedEntries.map(([k, v]) => `${k}=${String(v)}`).join("&");
    return `GET:${path}?${query}`;
  }

  private async requestGet(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<{ payload: unknown; cachedAt: string; fromCache: boolean }> {
    if (!this.apiKey) {
      throw new QlooApiError(
        "Missing QLOO_API_KEY in environment. Configure .env before making live Qloo requests.",
        401,
        path,
      );
    }

    const signature = this.buildCacheSignature(path, params);
    const existing = this.cache.get(signature);
    if (existing) {
      const ageMs = Date.now() - Date.parse(existing.cachedAt);
      if (ageMs <= this.cacheTtlMs) {
        return {
          payload: existing.payload,
          cachedAt: existing.cachedAt,
          fromCache: true,
        };
      }
    }

    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }

    let attempts = 0;
    let lastError: unknown;

    while (attempts <= this.maxRetries) {
      attempts++;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "X-Api-Key": this.apiKey,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        const text = await response.text();
        let parsedBody: unknown = text;
        try {
          parsedBody = JSON.parse(text);
        } catch {
          // Keep raw text snippet if response is non-JSON
        }

        if (response.ok) {
          const cachedAt = new Date().toISOString();
          this.cache.set(signature, {
            signature,
            cachedAt,
            payload: parsedBody,
          });
          return {
            payload: parsedBody,
            cachedAt,
            fromCache: false,
          };
        }

        if (response.status === 429 || response.status >= 500) {
          lastError = new QlooApiError(
            `Qloo API transient HTTP ${response.status} on ${path}`,
            response.status,
            path,
            parsedBody,
          );
          if (attempts <= this.maxRetries) {
            await new Promise((r) => setTimeout(r, 400 * 2 ** (attempts - 1)));
            continue;
          }
        }

        throw new QlooApiError(
          `Qloo API error HTTP ${response.status} on ${path}`,
          response.status,
          path,
          parsedBody,
        );
      } catch (err) {
        if (err instanceof QlooApiError && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastError = err;
        if (attempts <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** (attempts - 1)));
          continue;
        }
      }
    }

    if (lastError instanceof QlooApiError) {
      throw lastError;
    }
    throw new QlooApiError(
      lastError instanceof Error ? lastError.message : "Unknown Qloo network failure",
      503,
      path,
    );
  }

  private extractEntities(body: unknown): RawExtractedEntity[] {
    if (!isRecord(body)) return [];
    const results = body.results;
    let rawArray: unknown[] = [];

    if (Array.isArray(results)) {
      rawArray = results;
    } else if (isRecord(results) && Array.isArray(results.entities)) {
      rawArray = results.entities;
    } else if (Array.isArray(body.entities)) {
      rawArray = body.entities;
    }

    return rawArray.filter(isRecord).map((entity) => {
      const queryObj = isRecord(entity.query) ? entity.query : {};
      const types = Array.isArray(entity.types)
        ? entity.types.map(String)
        : typeof entity.type === "string"
          ? [entity.type]
          : [];

      const rawTags = Array.isArray(entity.tags) ? entity.tags.filter(isRecord) : [];
      const tags = rawTags
        .map((t) => ({
          id: String(t.id ?? t.tag_id ?? ""),
          name: String(t.name ?? ""),
          type: String(t.type ?? "urn:tag"),
        }))
        .filter((t) => t.id.length > 0 && t.name.length > 0);

      return {
        id: String(entity.entity_id ?? entity.id ?? ""),
        name: String(entity.name ?? ""),
        types,
        popularity: toFiniteNumber(entity.popularity),
        affinity:
          toFiniteNumber(queryObj.affinity) ??
          toFiniteNumber(entity.affinity) ??
          toFiniteNumber(entity.score),
        tags,
        raw: entity,
      };
    });
  }
}
