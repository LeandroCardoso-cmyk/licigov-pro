import React from "react";

interface CostSummary { totalRecords: number; totalCost: number; todayCost: number; monthCost: number; }
interface QuotaInfo { allowed: boolean; remaining: number; exceeded: boolean; }
interface Props { summary: CostSummary; quota: QuotaInfo; dailyLimit: number; organizationId: number; }

export function ProviderCostAnalytics({ summary, quota, dailyLimit, organizationId }: Props) {
  return (
    <div data-testid="cost-analytics">
      <h3>Cost Analytics — Org {organizationId}</h3>
      <div>Total Records: {summary.totalRecords}</div>
      <div>Total Cost: ${summary.totalCost.toFixed(4)}</div>
      <div>Today: ${summary.todayCost.toFixed(4)}</div>
      <div>This Month: ${summary.monthCost.toFixed(4)}</div>
      <div data-testid="quota-status">{quota.exceeded ? "EXCEEDED" : "OK"}</div>
      <div>Remaining: ${quota.remaining.toFixed(4)} / ${dailyLimit}</div>
    </div>
  );
}
