/** Defensive extraction helpers: the exact response shapes are what Phase 0 is verifying. */

export interface EntityLite {
  id: string;
  name: string;
  types: string[];
  popularity: number | null;
  affinity: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Finds the entity array in either /search ({results:[...]}) or /v2/insights ({results:{entities:[...]}}). */
export function extractEntities(body: unknown): EntityLite[] {
  if (!isObj(body)) return [];
  const results = body.results;
  let arr: unknown[] = [];
  if (Array.isArray(results)) arr = results;
  else if (isObj(results) && Array.isArray(results.entities)) arr = results.entities;
  else if (Array.isArray(body.entities)) arr = body.entities;

  return arr.filter(isObj).map((e) => {
    const query = isObj(e.query) ? e.query : {};
    const types = Array.isArray(e.types) ? e.types.map(String) : typeof e.type === "string" ? [e.type] : [];
    return {
      id: String(e.entity_id ?? e.id ?? ""),
      name: String(e.name ?? ""),
      types,
      popularity: num(e.popularity),
      affinity: num(query.affinity) ?? num(e.affinity) ?? num(e.score),
    };
  });
}

export const normalizeName = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export interface Resolution {
  input: string;
  status: "resolved" | "ambiguous" | "fuzzy" | "unresolved";
  match: EntityLite | null;
  alternatives: EntityLite[];
}

/** Picks a match: exact normalized name first, else top hit flagged as fuzzy. Ambiguous = multiple exact names. */
export function resolve(input: string, candidates: EntityLite[]): Resolution {
  const n = normalizeName(input);
  const exact = candidates.filter((c) => normalizeName(c.name) === n);
  if (exact.length === 1) return { input, status: "resolved", match: exact[0]!, alternatives: candidates.slice(0, 3) };
  if (exact.length > 1) {
    const best = [...exact].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0]!;
    return { input, status: "ambiguous", match: best, alternatives: exact };
  }
  if (candidates.length > 0) return { input, status: "fuzzy", match: candidates[0]!, alternatives: candidates.slice(0, 3) };
  return { input, status: "unresolved", match: null, alternatives: [] };
}

/**
 * Ordinal normalization fallback (PROJECT_PLAN §0.4).
 * Complete ranking of K returned brands → 1.0 (top) … 0.0 (last). Brands not returned are UNKNOWN (absent), not last.
 * Ties on affinity share the averaged ordinal position.
 */
export function ordinalPoints(ranked: { id: string; affinity: number | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  const k = ranked.length;
  if (k === 0) return out;
  if (k === 1) {
    out.set(ranked[0]!.id, 1);
    return out;
  }
  let i = 0;
  while (i < k) {
    let j = i;
    const a = ranked[i]!.affinity;
    while (j + 1 < k && a !== null && ranked[j + 1]!.affinity === a) j++;
    const avgPos = (i + j) / 2;
    const pts = 1 - avgPos / (k - 1);
    for (let p = i; p <= j; p++) out.set(ranked[p]!.id, Number(pts.toFixed(4)));
    i = j + 1;
  }
  return out;
}

export function stats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    n: values.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: Number(mean.toFixed(4)),
    spread: Number((sorted[sorted.length - 1]! - sorted[0]!).toFixed(4)),
  };
}
