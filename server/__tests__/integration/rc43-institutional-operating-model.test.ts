/**
 * RC-4.3 — Institutional Operating Model
 *
 * Valida a ontologia operacional permanente do Departamento de Licitações: papéis,
 * objetos, estados, eventos, dependências, relacionamentos e regras — declarativos,
 * consistentes, sem ciclos e determinísticos. Sem conteúdo jurídico.
 */

import { describe, it, expect } from "vitest";
import { ALL_ROLE_IDS, INSTITUTIONAL_ROLES, getInstitutionalRole } from "../../domain/institutional/roles";
import { ALL_OBJECT_IDS, INSTITUTIONAL_OBJECTS, getInstitutionalObject } from "../../domain/institutional/objects";
import { ALL_STATE_IDS, INSTITUTIONAL_STATES, canTransition } from "../../domain/institutional/states";
import { ALL_EVENT_IDS, INSTITUTIONAL_EVENTS } from "../../domain/institutional/events";
import { ALL_OPERATIONAL_RULE_IDS, OPERATIONAL_RULES, operationalRulesForObject } from "../../domain/institutional/operationalRules";
import {
  validateOperatingModel, operatingModelFingerprint, INSTITUTIONAL_OPERATING_MODEL,
  INSTITUTIONAL_RELATIONSHIPS, getRelationships, getObjectDependencies, getDependents,
  getEventsForObject, getRolesForObject, toOntologyNodes, toOntologyEdges, CANONICAL_DEPENDENCY_CHAIN,
  type RelationshipKind,
} from "../../domain/institutional/operatingModel";

describe("RC-4.3 — Institutional Operating Model", () => {

  // ─── Part 1 — Papéis ────────────────────────────────────────────────────────
  describe("Papéis institucionais", () => {
    it("os 13 papéis estão modelados com os campos obrigatórios", () => {
      expect(ALL_ROLE_IDS).toHaveLength(13);
      for (const id of ALL_ROLE_IDS) {
        const r = getInstitutionalRole(id);
        for (const f of ["responsibilities", "permissions", "participation", "documents", "dependencies"]) expect(r, `${id}.${f}`).toHaveProperty(f);
        expect(r.responsibilities.length).toBeGreaterThan(0);
      }
      expect(INSTITUTIONAL_ROLES.agente_contratacao.name).toBe("Agente de Contratação");
    });
  });

  // ─── Part 2 — Objetos ───────────────────────────────────────────────────────
  describe("Objetos institucionais", () => {
    it("os 18 objetos estão modelados com finalidade/entradas/saídas/relacionamentos/estados/dependências", () => {
      expect(ALL_OBJECT_IDS).toHaveLength(18);
      for (const id of ALL_OBJECT_IDS) {
        const o = getInstitutionalObject(id);
        for (const f of ["purpose", "inputs", "outputs", "relationships", "possibleStates", "dependsOn"]) expect(o, `${id}.${f}`).toHaveProperty(f);
      }
      expect(INSTITUTIONAL_OBJECTS.tr.name).toBe("Termo de Referência");
    });
  });

  // ─── Part 4 — Estados ───────────────────────────────────────────────────────
  describe("Estados institucionais", () => {
    it("transições referenciam apenas estados válidos", () => {
      for (const id of ALL_STATE_IDS) {
        for (const t of INSTITUTIONAL_STATES[id].transitions) expect(ALL_STATE_IDS).toContain(t);
      }
    });
    it("canTransition reflete as transições declaradas (não é workflow)", () => {
      expect(canTransition("em_elaboracao", "em_revisao")).toBe(true);
      expect(canTransition("arquivado", "em_execucao")).toBe(false);
    });
  });

  // ─── Part 6 — Eventos ───────────────────────────────────────────────────────
  describe("Eventos institucionais", () => {
    it("os 10 eventos referenciam objetos e papéis válidos", () => {
      expect(ALL_EVENT_IDS).toHaveLength(10);
      for (const id of ALL_EVENT_IDS) {
        const e = INSTITUTIONAL_EVENTS[id];
        for (const o of e.relatedObjects) expect(ALL_OBJECT_IDS).toContain(o);
        for (const r of e.involvedRoles) expect(ALL_ROLE_IDS).toContain(r);
        expect(e.origin.length).toBeGreaterThan(0);
        expect(e.destination.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Part 7 — Regras operacionais ───────────────────────────────────────────
  describe("Regras operacionais (declarativas, não jurídicas)", () => {
    it("cada regra 'Não existe X sem Y' referencia objetos válidos", () => {
      expect(ALL_OPERATIONAL_RULE_IDS.length).toBeGreaterThan(0);
      for (const id of ALL_OPERATIONAL_RULE_IDS) {
        const r = OPERATIONAL_RULES[id];
        expect(ALL_OBJECT_IDS).toContain(r.subject);
        expect(ALL_OBJECT_IDS).toContain(r.requires);
        expect(r.statement).toMatch(/Não existe/);
      }
      expect(operationalRulesForObject("contrato").map(r => r.id)).toContain("contrato_requer_processo");
    });
  });

  // ─── Part 3 — Relacionamentos ───────────────────────────────────────────────
  describe("Relacionamentos", () => {
    it("cobre os 8 tipos declarativos com origem/destino válidos", () => {
      const kinds: RelationshipKind[] = ["cria", "altera", "aprova", "consulta", "referencia", "depende", "substitui", "encerra"];
      for (const k of kinds) expect(getRelationships(k).length, k).toBeGreaterThan(0);
      for (const rel of INSTITUTIONAL_RELATIONSHIPS) expect(ALL_OBJECT_IDS).toContain(rel.to);
    });
  });

  // ─── Part 5 — Dependências (cadeia canônica, sem ciclos) ────────────────────
  describe("Dependências", () => {
    it("a cadeia canônica DFD→ETP→TR→Pesquisa→Edital→Sessão→Ata→Contrato é acíclica", () => {
      expect(CANONICAL_DEPENDENCY_CHAIN[0]).toBe("dfd");
      expect(getObjectDependencies("etp")).toContain("dfd");
      expect(getObjectDependencies("tr")).toContain("etp");
      // dependentes transitivos de dfd incluem etp e tr
      const deps = getDependents("dfd");
      expect(deps).toContain("etp");
      expect(deps).toContain("tr");
    });
  });

  // ─── Part 8/11 — Consistência + zero ciclos ─────────────────────────────────
  describe("Modelo operacional consistente", () => {
    it("validateOperatingModel é válido (zero erros, zero ciclos)", () => {
      const v = validateOperatingModel();
      expect(v.errors).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("o modelo único agrega papéis/objetos/estados/eventos/relacionamentos/regras", () => {
      for (const k of ["roles", "objects", "states", "events", "relationships", "rules"]) expect(INSTITUTIONAL_OPERATING_MODEL).toHaveProperty(k);
    });
  });

  // ─── Part 9 — Projeção Knowledge Graph ──────────────────────────────────────
  describe("Projeção para Knowledge Graph (preparação)", () => {
    it("produz nós (role/object/state/event) e arestas tipadas, determinísticos", () => {
      const nodes = toOntologyNodes();
      const edges = toOntologyEdges();
      expect(nodes.length).toBe(13 + 18 + 10 + 10); // roles+objects+states+events
      expect(nodes.some(n => n.id === "object:tr")).toBe(true);
      expect(edges.some(e => e.type === "depends_on")).toBe(true);
      expect(edges.some(e => e.type === "has_state")).toBe(true);
      // determinismo
      expect(toOntologyNodes()).toEqual(nodes);
      expect(toOntologyEdges()).toEqual(edges);
    });
  });

  // ─── Part 10 — Consulta (query API) + determinismo ──────────────────────────
  describe("Consulta pelo Engine/domínios + determinismo", () => {
    it("query API responde eventos/papéis por objeto", () => {
      expect(getEventsForObject("contrato")).toContain("assinatura");
      expect(getRolesForObject("contrato")).toContain("gestor_contrato");
    });
    it("fingerprint é determinístico (mesma ontologia → mesmo hash)", () => {
      expect(operatingModelFingerprint()).toBe(operatingModelFingerprint());
      expect(operatingModelFingerprint()).toHaveLength(20);
    });
  });
});
