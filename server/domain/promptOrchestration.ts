import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PromptStageType = "system" | "context" | "instruction" | "reasoning" | "output" | "validation" | "fallback";
export type PromptTransitionCondition = "always" | "on_success" | "on_failure" | "on_low_confidence" | "on_timeout";
export type PromptFallbackStrategy = "retry" | "simplify" | "skip" | "escalate" | "use_default";
export type PromptExecutionStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "fallback_used";

export interface PromptStage {
  id: string;
  name: string;
  stageType: PromptStageType;
  templateId: string;
  inputVariables: string[];
  outputSchema: Record<string, string>;
  maxTokens: number;
  timeoutMs: number;
  retryCount: number;
  fallbackStrategy: PromptFallbackStrategy;
  dependsOn: string[];
  guardrails: string[];
}

export interface PromptTransition {
  fromStageId: string;
  toStageId: string;
  condition: PromptTransitionCondition;
  confidenceThreshold?: number;
}

export interface PromptChain {
  id: string;
  organizationId: number;
  name: string;
  stages: PromptStage[];
  transitions: PromptTransition[];
  maxTotalTokens: number;
  replayKey: string;
  createdAt: string;
}

export interface PromptExecutionPlan {
  id: string;
  organizationId: number;
  chainId: string;
  executionOrder: string[];
  estimatedTokens: number;
  parallelizable: string[][];
  criticalPath: string[];
  replayKey: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

// ─── Core functions ───────────────────────────────────────────────────────────

export function createPromptStage(params: {
  name: string;
  stageType: PromptStageType;
  templateId: string;
  inputVariables?: string[];
  outputSchema?: Record<string, string>;
  maxTokens?: number;
  timeoutMs?: number;
  retryCount?: number;
  fallbackStrategy?: PromptFallbackStrategy;
  dependsOn?: string[];
  guardrails?: string[];
}): PromptStage {
  return {
    id:               genId(`${params.name}${params.stageType}${params.templateId}`),
    name:             params.name,
    stageType:        params.stageType,
    templateId:       params.templateId,
    inputVariables:   params.inputVariables ?? [],
    outputSchema:     params.outputSchema ?? {},
    maxTokens:        params.maxTokens ?? 2048,
    timeoutMs:        params.timeoutMs ?? 30000,
    retryCount:       params.retryCount ?? 1,
    fallbackStrategy: params.fallbackStrategy ?? "retry",
    dependsOn:        params.dependsOn ?? [],
    guardrails:       params.guardrails ?? [],
  };
}

export function createPromptChain(
  organizationId: number,
  params: {
    name: string;
    stages: PromptStage[];
    transitions: PromptTransition[];
    maxTotalTokens?: number;
  },
): PromptChain {
  const now = new Date().toISOString();
  const sortedStageIds = [...params.stages.map(s => s.id)].sort().join("");
  const replayKey = sha256(`${organizationId}${params.name}${sortedStageIds}`);
  return {
    id:             genId(replayKey),
    organizationId,
    name:           params.name,
    stages:         params.stages,
    transitions:    params.transitions,
    maxTotalTokens: params.maxTotalTokens ?? 32768,
    replayKey,
    createdAt:      now,
  };
}

export function buildExecutionPlan(chain: PromptChain): PromptExecutionPlan {
  const now = new Date().toISOString();

  // Kahn's topological sort
  const stageMap = new Map<string, PromptStage>(chain.stages.map(s => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const stage of chain.stages) {
    inDegree.set(stage.id, stage.dependsOn.length);
    adjacency.set(stage.id, []);
  }

  // Build forward edges
  for (const stage of chain.stages) {
    for (const depId of stage.dependsOn) {
      const adj = adjacency.get(depId);
      if (adj) adj.push(stage.id);
    }
  }

  // Kahn's BFS — track levels for parallelism detection
  const levels: string[][] = [];
  let queue = chain.stages.filter(s => s.dependsOn.length === 0).map(s => s.id);

  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];
    for (const stageId of queue) {
      for (const neighbor of adjacency.get(stageId) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }

  const executionOrder = levels.flat();

  // Parallelizable: levels with more than one stage
  const parallelizable = levels.filter(level => level.length > 1);

  // Critical path: longest chain by token cost
  const distMap = new Map<string, number>();
  const pathMap = new Map<string, string[]>();

  for (const stageId of executionOrder) {
    const stage = stageMap.get(stageId);
    if (!stage) continue;

    let maxPredCost = 0;
    let bestPath: string[] = [];

    for (const depId of stage.dependsOn) {
      const predCost = distMap.get(depId) ?? 0;
      if (predCost >= maxPredCost) {
        maxPredCost = predCost;
        bestPath = pathMap.get(depId) ?? [];
      }
    }

    distMap.set(stageId, maxPredCost + (stage.maxTokens));
    pathMap.set(stageId, [...bestPath, stageId]);
  }

  let maxCost = 0;
  let criticalPath: string[] = [];
  for (const [stageId, cost] of Array.from(distMap)) {
    if (cost > maxCost) {
      maxCost = cost;
      criticalPath = pathMap.get(stageId) ?? [stageId];
    }
  }

  const estimatedTokens = chain.stages.reduce((sum, s) => sum + s.maxTokens, 0);
  const replayKey = sha256(`${chain.id}${executionOrder.join(",")}`);

  return {
    id:              genId(replayKey),
    organizationId:  chain.organizationId,
    chainId:         chain.id,
    executionOrder,
    estimatedTokens,
    parallelizable,
    criticalPath,
    replayKey,
    createdAt:       now,
  };
}

export function validateChain(chain: PromptChain): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stageIds = new Set(chain.stages.map(s => s.id));

  // Verify all dependsOn references exist
  for (const stage of chain.stages) {
    for (const depId of stage.dependsOn) {
      if (!stageIds.has(depId)) {
        errors.push(`Stage '${stage.id}' (${stage.name}) depends on unknown stage '${depId}'`);
      }
    }
  }

  // Verify transitions point to valid stages
  for (const transition of chain.transitions) {
    if (!stageIds.has(transition.fromStageId)) {
      errors.push(`Transition references unknown fromStageId '${transition.fromStageId}'`);
    }
    if (!stageIds.has(transition.toStageId)) {
      errors.push(`Transition references unknown toStageId '${transition.toStageId}'`);
    }
  }

  // Detect cycles via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(stageId: string): boolean {
    if (inStack.has(stageId)) return true; // cycle detected
    if (visited.has(stageId)) return false;

    visited.add(stageId);
    inStack.add(stageId);

    const stage = chain.stages.find(s => s.id === stageId);
    if (stage) {
      for (const depId of stage.dependsOn) {
        if (dfs(depId)) return true;
      }
    }

    inStack.delete(stageId);
    return false;
  }

  for (const stage of chain.stages) {
    if (!visited.has(stage.id)) {
      if (dfs(stage.id)) {
        errors.push(`Cycle detected involving stage '${stage.id}' (${stage.name})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function getNextStages(chain: PromptChain, completedStageIds: string[]): PromptStage[] {
  const completedSet = new Set(completedStageIds);
  return chain.stages.filter(
    stage =>
      !completedSet.has(stage.id) &&
      stage.dependsOn.every(depId => completedSet.has(depId)),
  );
}

export function applyFallback(stage: PromptStage, strategy: PromptFallbackStrategy): PromptStage {
  return {
    ...stage,
    fallbackStrategy: strategy,
  };
}
