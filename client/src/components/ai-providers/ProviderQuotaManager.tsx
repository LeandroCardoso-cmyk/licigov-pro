import React from "react";

interface QuotaConfig { dailyLimit: number; monthlyLimit: number; alertThreshold: number; active: boolean; }
interface UsageInfo { todayCost: number; monthCost: number; totalCost: number; }
interface Props { quota: QuotaConfig; usage: UsageInfo; organizationId: number; }

export function ProviderQuotaManager({ quota, usage, organizationId }: Props) {
  const dailyPct = quota.dailyLimit > 0 ? (usage.todayCost / quota.dailyLimit) * 100 : 0;
  const monthlyPct = quota.monthlyLimit > 0 ? (usage.monthCost / quota.monthlyLimit) * 100 : 0;
  const alertTriggered = dailyPct / 100 >= quota.alertThreshold;
  return (
    <div data-testid="quota-manager">
      <h3>Quota Manager — Org {organizationId}</h3>
      <div data-testid="daily-usage">Daily: ${usage.todayCost.toFixed(4)} / ${quota.dailyLimit} ({dailyPct.toFixed(1)}%)</div>
      <div data-testid="monthly-usage">Monthly: ${usage.monthCost.toFixed(4)} / ${quota.monthlyLimit} ({monthlyPct.toFixed(1)}%)</div>
      {alertTriggered && <div data-testid="alert-triggered">ALERT: Approaching quota limit</div>}
      <div>Status: {quota.active ? "active" : "inactive"}</div>
    </div>
  );
}
