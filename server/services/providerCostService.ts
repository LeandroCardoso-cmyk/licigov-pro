import { createHash } from "crypto";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export interface CostRecord {
  readonly id: string;
  readonly organizationId: number;
  readonly providerId: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalCost: number;
  readonly recordedAt: string;
}

const _usage = new Map<number, CostRecord[]>();

export function estimateCost(providerType: string, promptTokens: number, completionTokens: number): number {
  const rates: Record<string, [number, number]> = { openai: [0.001, 0.002], claude: [0.0008, 0.0024], gemini: [0.0005, 0.0015], mock: [0, 0] };
  const [pRate, cRate] = rates[providerType] ?? [0.001, 0.002];
  return promptTokens * pRate + completionTokens * cRate;
}

export function recordUsage(input: { organizationId: number; providerId: string; model: string; promptTokens: number; completionTokens: number; providerType: string }): CostRecord {
  const totalCost = estimateCost(input.providerType, input.promptTokens, input.completionTokens);
  const id = sha256(`cost:${input.organizationId}:${input.providerId}:${Date.now()}`).slice(0,20);
  const record: CostRecord = { id, organizationId: input.organizationId, providerId: input.providerId, model: input.model, promptTokens: input.promptTokens, completionTokens: input.completionTokens, totalCost, recordedAt: new Date().toISOString() };
  const existing = _usage.get(input.organizationId) ?? [];
  _usage.set(input.organizationId, [...existing, record]);
  return record;
}

export function getTodayUsage(organizationId: number): CostRecord[] {
  const today = new Date().toISOString().slice(0,10);
  return (_usage.get(organizationId) ?? []).filter(r => r.recordedAt.startsWith(today));
}

export function getMonthlyUsage(organizationId: number): CostRecord[] {
  const month = new Date().toISOString().slice(0,7);
  return (_usage.get(organizationId) ?? []).filter(r => r.recordedAt.startsWith(month));
}

export function checkQuota(organizationId: number, dailyLimit: number): { allowed: boolean; remaining: number; exceeded: boolean } {
  const todayTotal = getTodayUsage(organizationId).reduce((s, r) => s + r.totalCost, 0);
  const remaining = Math.max(0, dailyLimit - todayTotal);
  return { allowed: todayTotal < dailyLimit, remaining, exceeded: todayTotal >= dailyLimit };
}

export function detectAnomaly(organizationId: number): { isAnomaly: boolean; message: string | null } {
  const all = _usage.get(organizationId) ?? [];
  if (all.length < 3) return { isAnomaly: false, message: null };
  const today = getTodayUsage(organizationId).reduce((s, r) => s + r.totalCost, 0);
  const avg = all.reduce((s, r) => s + r.totalCost, 0) / all.length;
  if (today > avg * 2 && avg > 0) return { isAnomaly: true, message: `Custo de hoje (${today.toFixed(4)}) é > 2x a média (${avg.toFixed(4)})` };
  return { isAnomaly: false, message: null };
}

export function getUsageSummary(organizationId: number): { totalRecords: number; totalCost: number; todayCost: number; monthCost: number } {
  const all = _usage.get(organizationId) ?? [];
  return { totalRecords: all.length, totalCost: all.reduce((s, r) => s + r.totalCost, 0), todayCost: getTodayUsage(organizationId).reduce((s, r) => s + r.totalCost, 0), monthCost: getMonthlyUsage(organizationId).reduce((s, r) => s + r.totalCost, 0) };
}
