import type { FestivalBrief, PlanVersion } from "@setfluence/shared";

interface ApiErrorPayload {
  error?: string;
  path?: string;
  source?: string;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON error body
  }

  if (!response.ok) {
    const errObj = (parsed ?? {}) as ApiErrorPayload;
    const message =
      errObj.error ?? `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed as T;
}

export async function generatePlan(brief: FestivalBrief): Promise<PlanVersion> {
  const response = await fetch("/api/plans/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief }),
  });

  const data = await parseJsonResponse<{ plan: PlanVersion }>(response);
  return data.plan;
}

export async function revisePlan(
  previousPlan: PlanVersion,
  updatedBrief: FestivalBrief,
  instruction?: string,
): Promise<PlanVersion> {
  const response = await fetch("/api/plans/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      previousPlan,
      updatedBrief,
      ...(instruction && instruction.trim().length > 0
        ? { instruction: instruction.trim() }
        : {}),
    }),
  });

  const data = await parseJsonResponse<{ plan: PlanVersion }>(response);
  return data.plan;
}
