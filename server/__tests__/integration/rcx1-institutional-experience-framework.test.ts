/**
 * RC-X.1 — Institutional Experience Framework
 *
 * Valida a arquitetura PERMANENTE da experiência do usuário (SEM UX definitiva/React/Design System/
 * IA/Business Domains/Lei 14.133): Experience Kernel, Institution Context (imutável), Capability
 * Matrix, Workspace Registry, Navigation Builder, Home Composer, Copilot EntryPoint, Explainability,
 * Observabilidade. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import { createInstitutionContext, isValidContext, hasModule } from "../../domain/experience/institutionContext";
import {
  createCapabilityRegistry, registerCapability, getCapability, resolveCapabilities, enabledCapabilityIds,
} from "../../domain/experience/capability";
import {
  createWorkspaceRegistry, registerWorkspace, getWorkspace, resolveWorkspaces, enabledWorkspaces,
} from "../../domain/experience/workspace";
import { buildNavigation, buildBreadcrumbs } from "../../domain/experience/navigationBuilder";
import { composeHome } from "../../domain/experience/homeComposer";
import { buildCopilotEntryPoint } from "../../domain/experience/copilotEntrypoint";
import { createExperienceKernel, buildExperience } from "../../domain/experience/experienceKernel";
import { explainNavigationItem, explainWorkspace } from "../../domain/experience/experienceExplainability";
import { validateExperience } from "../../domain/experience/experienceValidation";
import {
  sampleCapabilityRegistry, sampleWorkspaceRegistry, sampleExperienceKernel, sampleInstitutionContext,
  SAMPLE_CAPABILITIES, SAMPLE_WORKSPACES,
} from "../../domain/experience/experienceSample";
import { recordExperienceEvent, getExperienceEvents, clearExperienceEvents } from "../../services/experience/experienceObservabilityService";

const ORG = 12900;

describe("RC-X.1 — Institutional Experience Framework", () => {

  // ─── Part 2 — InstitutionContext ────────────────────────────────────────────
  describe("InstitutionContext (imutável, multi-tenant, replay-safe)", () => {
    it("possui todos os campos, é válido, imutável e determinístico", () => {
      const c = sampleInstitutionContext(ORG);
      for (const f of ["tenantId", "institutionId", "institutionName", "municipality", "state", "country", "tenantType", "activeCorpora", "enabledModules", "capabilities", "permissions", "workspaceIds", "resolutionChain", "branding", "metadata", "replayHash"]) expect(c, f).toHaveProperty(f);
      expect(isValidContext(c)).toBe(true);
      expect(c.replayHash).toHaveLength(32);
      expect(Object.isFrozen(c)).toBe(true);
      expect(() => { (c as { tenantId: number }).tenantId = 1; }).toThrow();
      expect(hasModule(c, "licitacoes")).toBe(true);
      // determinismo
      expect(sampleInstitutionContext(ORG).replayHash).toBe(c.replayHash);
    });
    it("multi-tenant: mesmo perfil em tenants distintos → replayHash distinto", () => {
      expect(sampleInstitutionContext(1).replayHash).not.toBe(sampleInstitutionContext(2).replayHash);
    });
  });

  // ─── Part 3 — Capability Matrix ─────────────────────────────────────────────
  describe("Capability Matrix (resolução por licenciamento)", () => {
    it("registra e resolve capacidades (módulo + contratação)", () => {
      let reg = createCapabilityRegistry();
      reg = registerCapability(reg, SAMPLE_CAPABILITIES[0]);
      reg = registerCapability(reg, SAMPLE_CAPABILITIES[0]); // idempotente
      expect(reg.capabilities).toHaveLength(1);
      expect(getCapability(reg, "processos")!.category).toBe("operacional");

      const full = sampleCapabilityRegistry();
      const grande = resolveCapabilities(full, sampleInstitutionContext(ORG, "municipio_grande"));
      expect(grande.find(r => r.capability.id === "processos")!.enabled).toBe(true);
      // município pequeno não contratou contratos
      const pequeno = enabledCapabilityIds(full, sampleInstitutionContext(ORG, "municipio_pequeno"));
      expect(pequeno).toContain("processos");
      expect(pequeno).not.toContain("contratos");
    });
    it("capacidade sem módulo habilitado → bloqueada, com razão", () => {
      const full = sampleCapabilityRegistry();
      const camara = resolveCapabilities(full, sampleInstitutionContext(ORG, "camara"));
      const contratos = camara.find(r => r.capability.id === "contratos")!;
      expect(contratos.enabled).toBe(false);
      expect(contratos.reason).toMatch(/módulo|contratada/);
    });
  });

  // ─── Part 4 — Workspace Registry ────────────────────────────────────────────
  describe("Workspace Registry (nenhum workspace sem Capability)", () => {
    it("registra, resolve e exige Capability", () => {
      const wsReg = sampleWorkspaceRegistry();
      expect(wsReg.workspaces).toHaveLength(SAMPLE_WORKSPACES.length);
      expect(getWorkspace(wsReg, "processos")!.category).toBe("operacional");
      // Part 8: workspace sem capability é rejeitado
      expect(() => registerWorkspace(wsReg, { id: "x", title: "X", description: "", icon: "", category: "operacional", requiredCapabilities: [], routes: [], actions: [], module: "m", metadata: {} })).toThrow();

      const capReg = sampleCapabilityRegistry();
      const grande = resolveWorkspaces(wsReg, capReg, sampleInstitutionContext(ORG, "municipio_grande"));
      expect(grande.find(r => r.workspace.id === "contratos")!.enabled).toBe(true);
      const pequeno = enabledWorkspaces(wsReg, capReg, sampleInstitutionContext(ORG, "municipio_pequeno")).map(r => r.workspace.id);
      expect(pequeno).toContain("processos");
      expect(pequeno).not.toContain("contratos");
    });
  });

  // ─── Part 5 — Navigation Builder ────────────────────────────────────────────
  describe("Navigation Builder (dinâmico, com explainability)", () => {
    it("monta sidebar/topNav/quickActions/menus só com workspaces habilitados", () => {
      const kernel = sampleExperienceKernel();
      const ctx = sampleInstitutionContext(ORG, "municipio_grande");
      const resolved = resolveWorkspaces(kernel.workspaceRegistry, kernel.capabilityRegistry, ctx);
      const nav = buildNavigation(resolved, ctx);
      expect(nav.sidebar.length).toBe(resolved.filter(r => r.enabled).length);
      expect(nav.sidebar.every(i => i.explanation.tenantId === ORG)).toBe(true);
      expect(nav.topNav.every(i => ["operacional", "contrato"].includes(i.category))).toBe(true);
      // quick actions só para ações cuja capability está habilitada
      expect(nav.quickActions.some(q => q.id === "qa:processos:novo_tr")).toBe(true);
      // breadcrumbs
      const bc = buildBreadcrumbs(nav, "/processos");
      expect(bc[0].route).toBe("/");
      expect(bc.some(c => c.route === "/processos")).toBe(true);
    });
    it("determinismo: mesma entrada → mesma navegação", () => {
      const kernel = sampleExperienceKernel();
      const ctx = sampleInstitutionContext(ORG, "municipio_grande");
      const r1 = resolveWorkspaces(kernel.workspaceRegistry, kernel.capabilityRegistry, ctx);
      expect(buildNavigation(r1, ctx)).toEqual(buildNavigation(r1, ctx));
    });
  });

  // ─── Part 6 — Home Composer ─────────────────────────────────────────────────
  describe("Home Composer (baseado no InstitutionContext)", () => {
    it("compõe widgets/cards/quickActions/recentes/favoritos/workspaces", () => {
      const kernel = sampleExperienceKernel();
      const ctx = sampleInstitutionContext(ORG, "municipio_grande");
      const resolved = resolveWorkspaces(kernel.workspaceRegistry, kernel.capabilityRegistry, ctx);
      const nav = buildNavigation(resolved, ctx);
      const home = composeHome(ctx, resolved, nav.quickActions);
      expect(home.institution.name).toBe(ctx.institutionName);
      expect(home.cards.length).toBe(resolved.filter(r => r.enabled).length);
      expect(home.workspaces).toContain("processos");
      expect(home.favoritos).toContain("processos");
      expect(home.recentes).toContain("/processos");
      expect(home.widgets.some(w => w.kind === "workspaces")).toBe(true);
    });
  });

  // ─── Part 7 — Copilot EntryPoint ────────────────────────────────────────────
  describe("Copilot EntryPoint (sem IA)", () => {
    it("habilitado quando a capacidade copilot está habilitada", () => {
      const kernel = sampleExperienceKernel();
      const ctxGrande = sampleInstitutionContext(ORG, "municipio_grande");
      const caps = resolveCapabilities(kernel.capabilityRegistry, ctxGrande);
      const ws = resolveWorkspaces(kernel.workspaceRegistry, kernel.capabilityRegistry, ctxGrande);
      const cp = buildCopilotEntryPoint(ctxGrande, caps, ws);
      expect(cp.enabled).toBe(true);
      expect(cp.context.availableWorkspaces).toContain("processos");
      // consórcio não contratou copilot
      const ctxCons = sampleInstitutionContext(ORG, "consorcio");
      const capsCons = resolveCapabilities(kernel.capabilityRegistry, ctxCons);
      const wsCons = resolveWorkspaces(kernel.workspaceRegistry, kernel.capabilityRegistry, ctxCons);
      expect(buildCopilotEntryPoint(ctxCons, capsCons, wsCons).enabled).toBe(false);
    });
  });

  // ─── Part 1 — Experience Kernel (orquestração) ──────────────────────────────
  describe("Experience Kernel (coordena toda a experiência)", () => {
    it("buildExperience resolve tudo de forma coerente e determinística", () => {
      const kernel = sampleExperienceKernel();
      const ctx = sampleInstitutionContext(ORG, "municipio_grande");
      const state = buildExperience(kernel, ctx);
      expect(state.capabilities.some(c => c.enabled)).toBe(true);
      expect(state.workspaces.some(w => w.enabled)).toBe(true);
      expect(state.navigation.sidebar.length).toBeGreaterThan(0);
      expect(state.home.cards.length).toBeGreaterThan(0);
      expect(state.copilot.enabled).toBe(true);
      // determinismo (sem correlationId → sem efeitos colaterais)
      expect(buildExperience(kernel, ctx)).toEqual(state);
    });
    it("Part 9 multi-tenant: tenants distintos veem experiências distintas", () => {
      const kernel = sampleExperienceKernel();
      const grande = buildExperience(kernel, sampleInstitutionContext(ORG, "municipio_grande"));
      const camara = buildExperience(kernel, sampleInstitutionContext(ORG, "camara"));
      const wsGrande = grande.workspaces.filter(w => w.enabled).length;
      const wsCamara = camara.workspaces.filter(w => w.enabled).length;
      expect(wsGrande).toBeGreaterThan(wsCamara);
    });
  });

  // ─── Part 12 — Explainability ───────────────────────────────────────────────
  describe("Explainability (por que apareceu / capability / módulo / workspace / tenant)", () => {
    it("explica item de navegação e workspace", () => {
      const kernel = sampleExperienceKernel();
      const ctx = sampleInstitutionContext(ORG, "municipio_grande");
      const state = buildExperience(kernel, ctx);
      const ex = explainNavigationItem(state.navigation.sidebar[0]);
      for (const f of ["subject", "appeared", "reason", "capability", "module", "workspace", "tenantId"]) expect(ex, f).toHaveProperty(f);
      expect(ex.tenantId).toBe(ORG);
      expect(ex.module.length).toBeGreaterThan(0);
      const rwContratos = state.workspaces.find(w => w.workspace.id === "contratos")!;
      expect(explainWorkspace(rwContratos, ctx).appeared).toBe(true);
    });
  });

  // ─── Validação ──────────────────────────────────────────────────────────────
  describe("validateExperience", () => {
    it("kernel de exemplo é válido: zero erros", () => {
      const kernel = sampleExperienceKernel();
      const v = validateExperience(sampleInstitutionContext(ORG), kernel.capabilityRegistry, kernel.workspaceRegistry);
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("detecta workspace com capacidade inexistente", () => {
      const kernel = sampleExperienceKernel();
      const badWs = createWorkspaceRegistry([{ id: "z", title: "Z", description: "", icon: "", category: "operacional", requiredCapabilities: ["inexistente"], routes: [], actions: [], module: "m", metadata: {} }]);
      expect(validateExperience(sampleInstitutionContext(ORG), kernel.capabilityRegistry, badWs).valid).toBe(false);
    });
  });

  // ─── Part 11 — Observabilidade ──────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("buildExperience com correlationId emite eventos recuperáveis", () => {
      clearExperienceEvents();
      const kernel = sampleExperienceKernel();
      buildExperience(kernel, sampleInstitutionContext(ORG, "municipio_grande"), "corr-rcx1");
      const evs = getExperienceEvents("corr-rcx1");
      expect(evs.length).toBeGreaterThan(0);
      expect(evs.map(e => e.type)).toContain("contextLoaded");
      expect(evs.map(e => e.type)).toContain("navigationGenerated");
      expect(evs.every(e => e.tenantId === ORG)).toBe(true);
      expect(getExperienceEvents("inexistente")).toEqual([]);
    });
    it("registro manual de evento e recuperação", () => {
      clearExperienceEvents();
      recordExperienceEvent({ correlationId: "c2", tenantId: ORG, type: "workspaceRegistered", subjectId: "processos", detail: "registrado", count: 1 });
      expect(getExperienceEvents("c2")).toHaveLength(1);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesma entrada → mesmo estado de experiência", () => {
      const kernel = sampleExperienceKernel();
      const ctx = sampleInstitutionContext(ORG, "municipio_grande");
      expect(buildExperience(kernel, ctx)).toEqual(buildExperience(kernel, ctx));
    });
  });
});
