/**
 * RC-X.2 — Institutional Bootstrap Framework
 *
 * Valida a camada que INICIALIZA a plataforma institucional (SEM login/JWT/sessão/banco/React/IA/
 * Business Domains/Lei 14.133): Bootstrap Kernel, Pipeline, Stages, Dependency Graph, Platform
 * State, Reload, Registry, Health, Explainability, Observabilidade. Multi-tenant, replay-safe,
 * determinístico.
 */

import { describe, it, expect } from "vitest";
import { ALL_PLATFORM_STATES, canTransition, isTerminal } from "../../domain/bootstrap/platformState";
import { aggregateHealth, isHealthy, ALL_BOOTSTRAP_HEALTH } from "../../domain/bootstrap/bootstrapHealth";
import { createStage } from "../../domain/bootstrap/bootstrapStage";
import {
  buildDependencyGraph, topologicalOrder, hasCycle, directDependencies, directDependents,
} from "../../domain/bootstrap/bootstrapDependencyGraph";
import {
  createBootstrapRegistry, registerSubsystem, getSubsystem, defaultInitializer,
} from "../../domain/bootstrap/bootstrapRegistry";
import { buildPipeline, getStage } from "../../domain/bootstrap/bootstrapPipeline";
import { createBootstrapKernel, runBootstrap } from "../../domain/bootstrap/bootstrapKernel";
import { planReload, RELOAD_TRIGGER_STAGE } from "../../domain/bootstrap/contextReload";
import { explainBootstrap, explainStep } from "../../domain/bootstrap/bootstrapExplainability";
import { sampleBootstrapKernel, sampleBootstrapRegistry, SAMPLE_SUBSYSTEMS } from "../../domain/bootstrap/bootstrapSample";
import { recordBootstrapEvent, getBootstrapEvents, clearBootstrapEvents } from "../../services/bootstrap/bootstrapObservabilityService";

const ORG = 13000;

describe("RC-X.2 — Institutional Bootstrap Framework", () => {

  // ─── Part 5 — Platform State ────────────────────────────────────────────────
  describe("Platform State", () => {
    it("estados e transições válidas", () => {
      expect(ALL_PLATFORM_STATES).toContain("READY");
      expect(ALL_PLATFORM_STATES).toHaveLength(6);
      expect(canTransition("BOOTING", "INITIALIZING")).toBe(true);
      expect(canTransition("INITIALIZING", "READY")).toBe(true);
      expect(canTransition("READY", "RELOADING")).toBe(true);
      expect(canTransition("BOOTING", "READY")).toBe(false);
      expect(isTerminal("READY")).toBe(true);
      expect(isTerminal("BOOTING")).toBe(false);
    });
  });

  // ─── Part 8 — Health Model ──────────────────────────────────────────────────
  describe("Health Model", () => {
    it("agrega saúde (pior prevalece)", () => {
      expect(ALL_BOOTSTRAP_HEALTH).toContain("DEGRADED");
      expect(aggregateHealth(["READY", "READY"])).toBe("READY");
      expect(aggregateHealth(["READY", "FAILED"])).toBe("FAILED");
      expect(aggregateHealth(["READY", "DEGRADED"])).toBe("DEGRADED");
      expect(aggregateHealth([])).toBe("UNKNOWN");
      expect(isHealthy("READY")).toBe(true);
    });
  });

  // ─── Part 4 — Dependency Resolution ─────────────────────────────────────────
  describe("Dependency Graph (determinístico, sem ciclos)", () => {
    it("ordena topologicamente de forma determinística e detecta ciclos", () => {
      const items = [
        createStage({ id: "b", dependencies: ["a"] }),
        createStage({ id: "a", dependencies: [] }),
        createStage({ id: "c", dependencies: ["a", "b"] }),
      ];
      const g = buildDependencyGraph(items.map(s => ({ id: s.id, dependencies: s.dependencies })));
      expect(hasCycle(g)).toBe(false);
      expect(topologicalOrder(g)).toEqual(["a", "b", "c"]);
      expect(directDependencies(g, "c")).toEqual(["a", "b"]);
      expect(directDependents(g, "a")).toEqual(["b", "c"]);
      // ciclo
      const cyc = buildDependencyGraph([{ id: "x", dependencies: ["y"] }, { id: "y", dependencies: ["x"] }]);
      expect(hasCycle(cyc)).toBe(true);
      expect(() => topologicalOrder(cyc)).toThrow();
    });
  });

  // ─── Part 7 — Service Registry ──────────────────────────────────────────────
  describe("Bootstrap Registry (append-only, extensível)", () => {
    it("registra subsistemas com initializer/healthCheck/shutdown padrão", () => {
      let reg = createBootstrapRegistry();
      reg = registerSubsystem(reg, { id: "auth", dependencies: [] });
      reg = registerSubsystem(reg, { id: "auth", dependencies: [] }); // idempotente
      expect(reg.subsystems).toHaveLength(1);
      const sub = getSubsystem(reg, "auth")!;
      expect(sub.initializer({ tenantId: ORG, stageId: "auth", metadata: {} }).status).toBe("completed");
      expect(sub.healthCheck({ tenantId: ORG, stageId: "auth", metadata: {} })).toBe("READY");
      expect(defaultInitializer({ tenantId: ORG, stageId: "x", metadata: {} }).health).toBe("READY");
    });
  });

  // ─── Part 2 — Bootstrap Pipeline ────────────────────────────────────────────
  describe("Bootstrap Pipeline (declarativo, ordem determinística)", () => {
    it("monta o pipeline canônico com authentication primeiro e ready por último", () => {
      const pipeline = buildPipeline(sampleBootstrapRegistry());
      expect(pipeline.stages).toHaveLength(SAMPLE_SUBSYSTEMS.length);
      expect(pipeline.order[0]).toBe("authentication");
      expect(pipeline.order[pipeline.order.length - 1]).toBe("ready");
      // dependências respeitadas: institution_context depois de authentication
      expect(pipeline.order.indexOf("institution_context")).toBeGreaterThan(pipeline.order.indexOf("authentication"));
      expect(pipeline.order.indexOf("home_resolution")).toBeGreaterThan(pipeline.order.indexOf("navigation_resolution"));
      expect(getStage(pipeline, "ready")!.dependencies).toContain("business_resolution");
      // determinismo
      expect(buildPipeline(sampleBootstrapRegistry()).order).toEqual(pipeline.order);
    });
  });

  // ─── Part 1 — Bootstrap Kernel (orquestração) ───────────────────────────────
  describe("Bootstrap Kernel (runBootstrap)", () => {
    it("inicializa tudo → READY, saúde READY, todas as etapas concluídas", () => {
      const kernel = sampleBootstrapKernel();
      const result = runBootstrap(kernel, { tenantId: ORG });
      expect(result.state).toBe("READY");
      expect(result.health).toBe("READY");
      expect(result.steps).toHaveLength(SAMPLE_SUBSYSTEMS.length);
      expect(result.steps.every(s => s.status === "completed")).toBe(true);
      expect(result.replayHash).toHaveLength(32);
    });
    it("etapa que falha → FAILED e dependentes são pulados", () => {
      const kernel = sampleBootstrapKernel([
        { id: "capability_resolution", dependencies: ["institution_context"], initializer: () => ({ status: "failed", health: "FAILED", detail: "falhou" }) },
      ]);
      // registo é append-only e idempotente por id: o subsistema original permanece.
      // Então criamos um kernel novo cujo capability_resolution falha via override direto:
      const reg = createBootstrapRegistry();
      let r = reg;
      for (const s of SAMPLE_SUBSYSTEMS) {
        r = registerSubsystem(r, s.id === "capability_resolution"
          ? { ...s, initializer: () => ({ status: "failed", health: "FAILED", detail: "falha simulada" }) }
          : s);
      }
      const failing = createBootstrapKernel(r);
      const result = runBootstrap(failing, { tenantId: ORG });
      expect(result.state).toBe("FAILED");
      const cap = result.steps.find(s => s.stageId === "capability_resolution")!;
      expect(cap.status).toBe("failed");
      // workspace_resolution depende de capability_resolution → pulado
      const ws = result.steps.find(s => s.stageId === "workspace_resolution")!;
      expect(ws.status).toBe("skipped");
      void kernel;
    });
    it("Part 9 multi-tenant + replay: mesmo tenant → mesmo replayHash; tenants distintos → distintos", () => {
      const kernel = sampleBootstrapKernel();
      const a = runBootstrap(kernel, { tenantId: ORG });
      const b = runBootstrap(kernel, { tenantId: ORG });
      expect(a.replayHash).toBe(b.replayHash);
      expect(runBootstrap(kernel, { tenantId: ORG + 1 }).replayHash).not.toBe(a.replayHash);
    });
  });

  // ─── Part 6 — Context Reload ────────────────────────────────────────────────
  describe("Context Reload (arquitetura)", () => {
    it("planeja reload determinístico (raiz + dependentes)", () => {
      const pipeline = buildPipeline(sampleBootstrapRegistry());
      const plan = planReload(pipeline, { trigger: "capabilities_update", tenantId: ORG });
      expect(plan.rootStage).toBe(RELOAD_TRIGGER_STAGE["capabilities_update"]);
      expect(plan.affectedStages[0]).toBe("capability_resolution");
      expect(plan.affectedStages).toContain("workspace_resolution");
      expect(plan.affectedStages).toContain("ready");
      expect(plan.toState).toBe("RELOADING");
      // troca de tenant recarrega tudo
      const full = planReload(pipeline, { trigger: "tenant_switch", tenantId: ORG });
      expect(full.affectedStages).toHaveLength(pipeline.order.length);
      // determinismo
      expect(planReload(pipeline, { trigger: "corpora_update", tenantId: ORG })).toEqual(planReload(pipeline, { trigger: "corpora_update", tenantId: ORG }));
    });
  });

  // ─── Part 10 — Explainability ───────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica qual componente carregou, por que, dependências, ordem e resultado", () => {
      const kernel = sampleBootstrapKernel();
      const result = runBootstrap(kernel, { tenantId: ORG });
      const explanations = explainBootstrap(kernel.pipeline, result);
      expect(explanations).toHaveLength(result.steps.length);
      for (const f of ["component", "loaded", "reason", "dependencyRequired", "requiredBy", "durationMs", "order", "result"]) expect(explanations[0], f).toHaveProperty(f);
      const wsStep = result.steps.find(s => s.stageId === "workspace_resolution")!;
      const wsEx = explainStep(kernel.pipeline, wsStep);
      expect(wsEx.dependencyRequired).toContain("capability_resolution");
      expect(wsEx.loaded).toBe(true);
      // authentication é raiz
      const authEx = explanations.find(e => e.component === "authentication")!;
      expect(authEx.dependencyRequired).toEqual([]);
    });
  });

  // ─── Part 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("runBootstrap com correlationId emite eventos recuperáveis", () => {
      clearBootstrapEvents();
      const kernel = sampleBootstrapKernel();
      runBootstrap(kernel, { tenantId: ORG, correlationId: "corr-rcx2" });
      const evs = getBootstrapEvents("corr-rcx2");
      expect(evs.length).toBeGreaterThan(0);
      const types = evs.map(e => e.type);
      expect(types).toContain("bootstrapStarted");
      expect(types).toContain("bootstrapFinished");
      expect(types).toContain("subsystemLoaded");
      expect(evs.every(e => e.tenantId === ORG)).toBe(true);
      expect(getBootstrapEvents("inexistente")).toEqual([]);
    });
    it("registro manual de evento e recuperação", () => {
      clearBootstrapEvents();
      recordBootstrapEvent({ correlationId: "c2", tenantId: ORG, type: "stageStarted", subjectId: "authentication", detail: "x", count: 1 });
      expect(getBootstrapEvents("c2")).toHaveLength(1);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesma entrada → mesmo resultado (ignorando efeitos colaterais)", () => {
      const kernel = sampleBootstrapKernel();
      const a = runBootstrap(kernel, { tenantId: ORG });
      const b = runBootstrap(kernel, { tenantId: ORG });
      expect(a.order).toEqual(b.order);
      expect(a.state).toBe(b.state);
      expect(a.steps.map(s => [s.stageId, s.status, s.health])).toEqual(b.steps.map(s => [s.stageId, s.status, s.health]));
    });
  });
});
