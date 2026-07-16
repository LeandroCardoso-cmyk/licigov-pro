/**
 * RC-4.3.1 — Institutional Ontology Validation
 *
 * Valida exaustivamente a Ontologia Operacional: integridade (papéis/objetos/estados/
 * eventos/dependências/relacionamentos/KG), expressividade (cenários reais) e resiliência
 * (detecção de inconsistências). Sem conteúdo jurídico/IA/RAG. Determinístico.
 */

import { describe, it, expect } from "vitest";
import {
  validateOntology, validateRoles, validateObjects, validateStates, validateEvents,
  validateDependencies, validateRelationships, validateKnowledgeGraphProjection,
  detectCycle, reachableStates, objectRefValid, roleRefValid, stateRefValid, eventRefValid,
} from "../../domain/institutional/ontologyValidation";
import {
  INSTITUTIONAL_SCENARIOS, ALL_SCENARIO_IDS, validateScenario, validateAllScenarios,
  scenarioCoverage, type InstitutionalScenario,
} from "../../domain/institutional/scenarios";
import { ALL_STATE_IDS } from "../../domain/institutional/states";

describe("RC-4.3.1 — Institutional Ontology Validation", () => {

  // ─── Parts 1-6, 10 — Validação por seção ────────────────────────────────────
  describe("Integridade da ontologia", () => {
    it("validação integral: zero erros em todas as seções", () => {
      const r = validateOntology();
      expect(r.issues, r.issues.join("; ")).toEqual([]);
      expect(r.valid).toBe(true);
      for (const s of r.sections) expect(s.ok, `${s.section}: ${s.issues.join(",")}`).toBe(true);
    });

    it("papéis: campos, referências e não-isolamento (Part 1)", () => {
      expect(validateRoles().ok).toBe(true);
    });
    it("objetos: campos, estados, dependências, não-órfãos (Part 2)", () => {
      expect(validateObjects().ok).toBe(true);
    });
    it("estados: transições válidas, sem inalcançáveis, sem dead-end não-final (Part 3)", () => {
      expect(validateStates().ok).toBe(true);
      const reached = reachableStates();
      for (const s of ALL_STATE_IDS) expect(reached.has(s), `inalcançável: ${s}`).toBe(true);
    });
    it("eventos: origem/destino/objetos/papéis, sem órfãos (Part 4)", () => {
      expect(validateEvents().ok).toBe(true);
    });
    it("dependências: sem ciclos, sem quebras (Part 5)", () => {
      expect(validateDependencies().ok).toBe(true);
    });
    it("relacionamentos: sem duplicados/impossíveis/sem objeto (Part 6)", () => {
      expect(validateRelationships().ok).toBe(true);
    });
    it("Knowledge Graph: nós/arestas/cardinalidade íntegros (Part 10)", () => {
      expect(validateKnowledgeGraphProjection().ok).toBe(true);
    });
  });

  // ─── Part 7 — Expressividade ────────────────────────────────────────────────
  describe("Expressividade (cenários reais representáveis sem alterar a ontologia)", () => {
    it("todos os cenários oficiais são representáveis", () => {
      const results = validateAllScenarios();
      const naoRepresentaveis = results.filter(r => !r.representable);
      expect(naoRepresentaveis, JSON.stringify(naoRepresentaveis)).toEqual([]);
      expect(results.length).toBe(INSTITUTIONAL_SCENARIOS.length);
    });

    it("cobre modalidades e casos exigidos (pregão, dispensa, registro de preços, legado, ERP, parcial)", () => {
      for (const id of ["pregao", "concorrencia", "dispensa", "inexigibilidade", "credenciamento", "registro_precos", "convenio", "aditivo", "apostilamento", "rescisao", "fiscalizacao", "encerramento", "processo_legado", "processo_erp", "processo_licigov", "processo_parcial", "contratacao_emergencial"]) {
        expect(ALL_SCENARIO_IDS, `cenário ${id}`).toContain(id);
      }
    });

    it("os cenários exercitam 100% de objetos, papéis, eventos e estados", () => {
      const c = scenarioCoverage();
      expect(c.objects).toBe(18);
      expect(c.roles).toBe(13);
      expect(c.events).toBe(10);
      expect(c.states).toBe(10);
    });
  });

  // ─── Part 8 — Resiliência (detecta inconsistências propositais) ─────────────
  describe("Resiliência (o sistema detecta inconsistências)", () => {
    it("detecta ciclo em grafo de dependências sintético", () => {
      expect(detectCycle({ a: ["b"], b: ["c"], c: ["a"] })).toBe(true);
      expect(detectCycle({ a: ["b"], b: ["c"], c: [] })).toBe(false);
    });

    it("detecta referências quebradas (objeto/papel/estado/evento inválidos)", () => {
      expect(objectRefValid("contrato")).toBe(true);
      expect(objectRefValid("objeto_inexistente")).toBe(false);
      expect(roleRefValid("agente_contratacao")).toBe(true);
      expect(roleRefValid("papel_inexistente")).toBe(false);
      expect(stateRefValid("publicado")).toBe(true);
      expect(stateRefValid("estado_impossivel")).toBe(false);
      expect(eventRefValid("sessao")).toBe(true);
      expect(eventRefValid("evento_orfao")).toBe(false);
    });

    it("cenário quebrado (objeto/papel/estado/evento inexistentes) é detectado como não-representável", () => {
      const broken: InstitutionalScenario = {
        id: "broken", name: "quebrado",
        objects: ["contrato", "objeto_x" as any], roles: ["papel_x" as any],
        events: ["evento_x" as any], states: ["estado_x" as any],
      };
      const v = validateScenario(broken);
      expect(v.representable).toBe(false);
      expect(v.missing).toEqual(expect.arrayContaining(["object:objeto_x", "role:papel_x", "event:evento_x", "state:estado_x"]));
    });
  });

  // ─── Part 9 — Consistência + Replay Safety ──────────────────────────────────
  describe("Consistência e determinismo (Replay Safety)", () => {
    it("validação é determinística (mesma ontologia → mesmo resultado)", () => {
      const a = validateOntology();
      const b = validateOntology();
      expect(a.valid).toBe(b.valid);
      expect(a.issues).toEqual(b.issues);
      expect(a.coverage).toEqual(b.coverage);
    });
    it("nenhum ciclo, nenhuma ambiguidade de cobertura", () => {
      const r = validateOntology();
      expect(r.coverage.nodes).toBe(13 + 18 + 10 + 10);
      expect(r.issues.some(i => /ciclo/.test(i))).toBe(false);
    });
  });
});
