import { describe, it, expect } from "vitest";

// Domain
import {
  KERNEL_SERVICES,
  ALL_KERNEL_SERVICE_IDS,
  isKernelService,
  createKernelServiceRecord,
} from "../../domain/cognitiveKernel";
import {
  createBusinessDomain,
  listBusinessDomains,
  getBusinessDomainDefinition,
  ALL_BUSINESS_DOMAIN_CODES,
} from "../../domain/businessDomain";
import { createDomainWorkspace } from "../../domain/domainWorkspace";
import {
  createLicensedModule,
  isExpired,
  isLicenseActive,
  deactivateModule as deactivateModuleDomain,
  hasFeature,
} from "../../domain/licensedModule";
import { createModuleDependency, resolveDomainDependencies } from "../../domain/moduleDependency";
import { createFeatureFlag, isFeatureEnabled, toggleFeature } from "../../domain/featureFlag";
import { assembleProcess, validateProcessDefinition } from "../../domain/adaptiveProcessEngine";

// Services
import {
  checkKernelAccess,
  assertKernelAccess,
  listKernelServicesForDomain,
  listAllKernelServices,
} from "../../services/kernelAccessService";
import { listDomains, getDomain, getDomainDependencies, buildAllDependencies, registerAll } from "../../services/businessDomainRegistryService";
import { createOrLaunchWorkspace } from "../../services/domainWorkspaceService";
import { activateModule, deactivateModule, validateLicense, isModuleLicensed, listOrganizationModules } from "../../services/moduleLicensingService";
import { setFlag, isModuleFeatureEnabled } from "../../services/moduleFeatureFlagService";
import { buildPortal } from "../../services/domainNavigationService";

// Persistence
import { upsertBusinessDomain, listLicensedModules, upsertLicensedModule } from "../../db/businessDomains";

const ORG_ID = 10400;
const CORR = "corr-5010";
const NOW = "2026-07-06T00:00:00.000Z";

describe("Sprint 5.0.1 — Business Domain Architecture & Modular Licensing", () => {

  // ─── Cognitive Kernel ──────────────────────────────────────────────────────

  describe("cognitiveKernel", () => {
    it("registra 25 Kernel Services", () => {
      // RC-3.5 — +3 componentes permanentes: ai_execution_engine, provider_adapter, storage_service.
      expect(ALL_KERNEL_SERVICE_IDS).toHaveLength(25);
      expect(KERNEL_SERVICES.institutional_rag.name).toBe("Institutional RAG");
    });

    it("isKernelService valida ids", () => {
      expect(isKernelService("workflow_engine")).toBe(true);
      expect(isKernelService("modulo_comercial")).toBe(false);
    });

    it("createKernelServiceRecord é determinístico", () => {
      const a = createKernelServiceRecord("replay_engine");
      const b = createKernelServiceRecord("replay_engine");
      expect(a.id).toBe(b.id);
      expect(a.serviceId).toBe("replay_engine");
    });
  });

  // ─── Business Domain ───────────────────────────────────────────────────────

  describe("businessDomain", () => {
    it("existem 5 domínios de negócio", () => {
      expect(ALL_BUSINESS_DOMAIN_CODES).toHaveLength(5);
      expect(listBusinessDomains()).toHaveLength(5);
    });

    it("createBusinessDomain é determinístico (id por code)", () => {
      const a = createBusinessDomain("processo_licitatorio");
      const b = createBusinessDomain("processo_licitatorio");
      expect(a.id).toBe(b.id);
      expect(a.name).toBe("Processo Licitatório");
    });

    it("Contratos depende de Processo Licitatório", () => {
      expect(getBusinessDomainDefinition("contratos").dependencies).toContain("processo_licitatorio");
    });

    it("todos os domínios declaram serviços de Kernel exigidos", () => {
      for (const code of ALL_BUSINESS_DOMAIN_CODES) {
        expect(getBusinessDomainDefinition(code).requiredKernelServices.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Domain Workspace (isolamento) ─────────────────────────────────────────

  describe("domainWorkspace", () => {
    it("cada domínio tem workspace próprio (id distinto por domínio)", () => {
      const a = createDomainWorkspace({ organizationId: ORG_ID, businessDomainId: "d1", businessDomainCode: "processo_licitatorio", workspaceType: "licitacao", correlationId: CORR });
      const b = createDomainWorkspace({ organizationId: ORG_ID, businessDomainId: "d2", businessDomainCode: "contratos", workspaceType: "contrato", correlationId: CORR });
      expect(a.id).not.toBe(b.id);
    });

    it("workspace determinístico por (org, domínio)", () => {
      const a = createDomainWorkspace({ organizationId: ORG_ID, businessDomainId: "d1", businessDomainCode: "processo_licitatorio", workspaceType: "licitacao", correlationId: CORR });
      const b = createDomainWorkspace({ organizationId: ORG_ID, businessDomainId: "d1", businessDomainCode: "processo_licitatorio", workspaceType: "licitacao", correlationId: "outro" });
      expect(a.id).toBe(b.id);
    });

    it("multi-tenant: org diferente → workspace diferente", () => {
      const a = createDomainWorkspace({ organizationId: ORG_ID, businessDomainId: "d1", businessDomainCode: "processo_licitatorio", workspaceType: "licitacao", correlationId: CORR });
      const b = createDomainWorkspace({ organizationId: 99999, businessDomainId: "d1", businessDomainCode: "processo_licitatorio", workspaceType: "licitacao", correlationId: CORR });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ─── Licensed Module ───────────────────────────────────────────────────────

  describe("licensedModule", () => {
    const mk = (exp: string | null = null) => createLicensedModule({ organizationId: ORG_ID, businessDomainCode: "processo_licitatorio", activationDate: "2026-01-01T00:00:00.000Z", expirationDate: exp, plan: "professional", licensedFeatures: ["tr_inteligente"] });

    it("cria módulo com id determinístico por (org, domínio)", () => {
      expect(mk().id).toBe(mk().id);
    });

    it("isExpired detecta expiração", () => {
      expect(isExpired(mk("2025-01-01T00:00:00.000Z"), NOW)).toBe(true);
      expect(isExpired(mk("2027-01-01T00:00:00.000Z"), NOW)).toBe(false);
      expect(isExpired(mk(null), NOW)).toBe(false);
    });

    it("isLicenseActive combina ativo e não expirado", () => {
      expect(isLicenseActive(mk("2027-01-01T00:00:00.000Z"), NOW)).toBe(true);
      expect(isLicenseActive(deactivateModuleDomain(mk(null)), NOW)).toBe(false);
    });

    it("hasFeature verifica funcionalidade licenciada", () => {
      expect(hasFeature(mk(), "tr_inteligente")).toBe(true);
      expect(hasFeature(mk(), "inexistente")).toBe(false);
    });
  });

  // ─── Module Dependency ─────────────────────────────────────────────────────

  describe("moduleDependency", () => {
    it("createModuleDependency é determinístico", () => {
      const a = createModuleDependency({ dependentCode: "contratos", kind: "domain", dependsOn: "processo_licitatorio" });
      const b = createModuleDependency({ dependentCode: "contratos", kind: "domain", dependsOn: "processo_licitatorio" });
      expect(a.id).toBe(b.id);
    });

    it("resolveDomainDependencies detecta faltantes", () => {
      const deps = [createModuleDependency({ dependentCode: "contratos", kind: "domain", dependsOn: "processo_licitatorio" })];
      expect(resolveDomainDependencies(deps, new Set()).satisfied).toBe(false);
      expect(resolveDomainDependencies(deps, new Set(["processo_licitatorio"])).satisfied).toBe(true);
    });

    it("dependências de kernel não bloqueiam resolução de domínio", () => {
      const deps = [createModuleDependency({ dependentCode: "contratos", kind: "kernel", dependsOn: "institutional_rag" })];
      expect(resolveDomainDependencies(deps, new Set()).satisfied).toBe(true);
    });
  });

  // ─── Feature Flag ──────────────────────────────────────────────────────────

  describe("featureFlag", () => {
    it("isFeatureEnabled respeita a estratégia", () => {
      expect(isFeatureEnabled(createFeatureFlag({ organizationId: ORG_ID, featureKey: "f", rolloutStrategy: "on" }))).toBe(true);
      expect(isFeatureEnabled(createFeatureFlag({ organizationId: ORG_ID, featureKey: "f", rolloutStrategy: "off" }))).toBe(false);
      expect(isFeatureEnabled(createFeatureFlag({ organizationId: ORG_ID, featureKey: "f", rolloutStrategy: "org_scoped", enabled: true }))).toBe(true);
    });

    it("toggleFeature habilita/desabilita", () => {
      const off = createFeatureFlag({ organizationId: ORG_ID, featureKey: "f" });
      expect(isFeatureEnabled(toggleFeature(off, true))).toBe(true);
      expect(isFeatureEnabled(toggleFeature(off, false))).toBe(false);
    });
  });

  // ─── Adaptive Process Engine ───────────────────────────────────────────────

  describe("adaptiveProcessEngine", () => {
    const def = {
      businessDomainCode: "processo_licitatorio" as const,
      workflowKey: "tr",
      steps: [
        { key: "dfd", name: "DFD", documents: ["dfd"], mandatory: true, requiresApproval: false, predominantCopilot: "planejamento" as const, exceptions: [] },
        { key: "etp", name: "ETP", documents: ["etp"], mandatory: true, requiresApproval: true, predominantCopilot: "planejamento" as const, exceptions: [] },
        { key: "tr", name: "TR", documents: ["tr"], mandatory: true, requiresApproval: true, predominantCopilot: "tr_intelligence" as const, exceptions: [] },
      ],
    };

    it("assembleProcess é determinístico e extrai obrigatórias/aprovações/copilotos", () => {
      const a = assembleProcess(def);
      const b = assembleProcess(def);
      expect(a.signature).toBe(b.signature);
      expect(a.mandatorySteps).toEqual(["dfd", "etp", "tr"]);
      expect(a.approvalSteps).toEqual(["etp", "tr"]);
      expect(a.predominantCopilots).toContain("planejamento");
      expect(a.predominantCopilots).toContain("tr_intelligence");
    });

    it("validateProcessDefinition detecta etapas duplicadas e vazias", () => {
      expect(validateProcessDefinition(def).valid).toBe(true);
      expect(validateProcessDefinition({ ...def, steps: [] }).valid).toBe(false);
      const dup = { ...def, steps: [def.steps[0], def.steps[0]] };
      expect(validateProcessDefinition(dup).valid).toBe(false);
    });
  });

  // ─── Kernel Access Service (regra de arquitetura) ──────────────────────────

  describe("kernelAccessService", () => {
    it("permite acesso a serviço declarado pelo domínio", () => {
      expect(checkKernelAccess("processo_licitatorio", "institutional_rag").allowed).toBe(true);
    });

    it("nega acesso a serviço não declarado pelo domínio", () => {
      // gestao_departamento não declara institutional_rag
      const r = checkKernelAccess("gestao_departamento", "institutional_rag");
      expect(r.allowed).toBe(false);
    });

    it("nega acesso a id que não é serviço de Kernel", () => {
      expect(checkKernelAccess("processo_licitatorio", "provider_secreto").allowed).toBe(false);
    });

    it("assertKernelAccess lança quando negado", () => {
      expect(() => assertKernelAccess("gestao_departamento", "procurement_knowledge_graph")).toThrow();
    });

    it("listKernelServicesForDomain e listAllKernelServices", () => {
      expect(listKernelServicesForDomain("processo_licitatorio")).toContain("workflow_engine");
      expect(listAllKernelServices()).toHaveLength(25);
    });
  });

  // ─── Registry Service ──────────────────────────────────────────────────────

  describe("businessDomainRegistryService", () => {
    it("listDomains retorna 5", () => {
      expect(listDomains()).toHaveLength(5);
    });

    it("getDomain retorna definição", () => {
      expect(getDomain("parecer_juridico").name).toBe("Parecer Jurídico");
    });

    it("buildAllDependencies inclui dependências de domínio e kernel", () => {
      const deps = buildAllDependencies();
      expect(deps.some(d => d.dependentCode === "contratos" && d.kind === "domain" && d.dependsOn === "processo_licitatorio")).toBe(true);
      expect(deps.some(d => d.kind === "kernel")).toBe(true);
    });

    it("getDomainDependencies filtra por domínio", () => {
      const deps = getDomainDependencies("contratos");
      expect(deps.every(d => d.dependentCode === "contratos")).toBe(true);
    });

    it("registerAll degrada sem DB", async () => {
      const result = await registerAll();
      expect(result.domains).toBe(5);
      expect(result.kernelServices).toBe(25);
    });
  });

  // ─── Licensing Service ─────────────────────────────────────────────────────

  describe("moduleLicensingService", () => {
    it("activateModule reporta dependências faltantes (Contratos sem Processo)", async () => {
      const { missingDependencies } = await activateModule({ organizationId: ORG_ID, businessDomainCode: "contratos", activationDate: NOW });
      expect(missingDependencies).toContain("processo_licitatorio");
    });

    it("activateModule sem dependências não reporta faltantes", async () => {
      const { missingDependencies } = await activateModule({ organizationId: ORG_ID, businessDomainCode: "processo_licitatorio", activationDate: NOW });
      expect(missingDependencies).toHaveLength(0);
    });

    it("validateLicense retorna não-licenciado sem DB", async () => {
      const v = await validateLicense(ORG_ID, "processo_licitatorio", NOW);
      expect(v.licensed).toBe(false);
    });

    it("isModuleLicensed false sem DB", async () => {
      await expect(isModuleLicensed(ORG_ID, "contratos", NOW)).resolves.toBe(false);
    });

    it("deactivateModule / listOrganizationModules degradam", async () => {
      await expect(deactivateModule(ORG_ID, "contratos")).resolves.toBe(false);
      await expect(listOrganizationModules(ORG_ID)).resolves.toEqual([]);
    });
  });

  // ─── Feature Flag Service ──────────────────────────────────────────────────

  describe("moduleFeatureFlagService", () => {
    it("setFlag retorna flag; isModuleFeatureEnabled false sem DB (default seguro)", async () => {
      const flag = await setFlag({ organizationId: ORG_ID, featureKey: "tr_inteligente", enabled: true });
      expect(flag.featureKey).toBe("tr_inteligente");
      await expect(isModuleFeatureEnabled(ORG_ID, "tr_inteligente")).resolves.toBe(false);
    });
  });

  // ─── Domain Navigation (Portal) ────────────────────────────────────────────

  describe("domainNavigationService", () => {
    it("buildPortal lista 5 domínios; visível vazio sem licenças (sem DB)", async () => {
      const portal = await buildPortal(ORG_ID, NOW);
      expect(portal.entries).toHaveLength(5);
      expect(portal.visible).toHaveLength(0);
      expect(portal.entries.every(e => e.licensed === false)).toBe(true);
    });
  });

  // ─── Domain Workspace Service ──────────────────────────────────────────────

  describe("domainWorkspaceService", () => {
    it("createOrLaunchWorkspace cria workspace próprio do domínio", async () => {
      const ws = await createOrLaunchWorkspace({ organizationId: ORG_ID, businessDomainCode: "processo_licitatorio", correlationId: CORR });
      expect(ws.businessDomainCode).toBe("processo_licitatorio");
      expect(ws.workspaceType).toBe("licitacao");
    });
  });

  // ─── Persistence: graceful degradation ─────────────────────────────────────

  describe("persistence — degradação graciosa sem DB", () => {
    it("upsertBusinessDomain null / listLicensedModules [] sem DB", async () => {
      await expect(upsertBusinessDomain(createBusinessDomain("contratos"))).resolves.toBeNull();
      await expect(listLicensedModules(ORG_ID)).resolves.toEqual([]);
    });

    it("upsertLicensedModule null sem DB", async () => {
      const m = createLicensedModule({ organizationId: ORG_ID, businessDomainCode: "contratos", activationDate: NOW });
      await expect(upsertLicensedModule(m)).resolves.toBeNull();
    });
  });
});
