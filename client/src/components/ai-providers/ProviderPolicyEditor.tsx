import React, { useState } from "react";

interface Policy { id: string; policyName: string; allowedProviders: string[]; blockedModels: string[]; maxTokensPerExecution: number; maxCostPerExecution: number; dailyCostLimit: number; approvalThreshold: number; requiresHumanApproval: boolean; active: boolean; }
interface Props { policies: Policy[]; organizationId: number; onCreatePolicy?: (name: string) => void; }

export function ProviderPolicyEditor({ policies, organizationId, onCreatePolicy }: Props) {
  const [newName, setNewName] = useState("");
  return (
    <div data-testid="policy-editor">
      <h3>Policies — Org {organizationId}</h3>
      <div>Active: {policies.filter(p => p.active).length}</div>
      {policies.map(p => (
        <div key={p.id} data-testid={`policy-${p.id}`}>
          <span>{p.policyName}</span>
          <span>Max Tokens: {p.maxTokensPerExecution}</span>
          <span>Daily Limit: ${p.dailyCostLimit}</span>
          <span>{p.active ? "active" : "inactive"}</span>
        </div>
      ))}
      {onCreatePolicy && (
        <div>
          <input data-testid="policy-name-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Policy name" />
          <button data-testid="create-policy-btn" onClick={() => { onCreatePolicy(newName); setNewName(""); }}>Create</button>
        </div>
      )}
    </div>
  );
}
