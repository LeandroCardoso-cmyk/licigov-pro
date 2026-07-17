/**
 * RC-4.4.1 — Ontology Integration Layer
 *
 * Valida a camada semântica que conecta a Ontologia Operacional (RC-4.3) e a Jurídica
 * (RC-4.4) sem acoplá-las: tipos de ligação, links explicáveis, mapa semântico, cross
 * references, consultas e projeção KG. Determinístico, replay-safe, explicável. Sem IA/leis.
 */

import { describe, it, expect } from "vitest";
import {
  SEMANTIC_LINK_TYPES, ALL_SEMANTIC_LINK_TYPE_IDS, ALL_LINK_CARDINALITIES, ALL_LINK_DIRECTIONS,
} from "../../domain/integration/semanticLinkTypes";
import { SEMANTIC_LINKS, ALL_LINK_IDS } from "../../domain/integration/ontologyLinks";
import {
  validateIntegrationLayer, refExists, linksFor, linksByType, conceptsForObject, objectsForConcept,
  rolesForConcept, eventsForConcept, statesForConcept, operatingCrossRef, legalCrossRef,
  SEMANTIC_MAPS, toIntegrationNodes, toIntegrationEdges, integrationFingerprint,
  ONTOLOGY_INTEGRATION_MODEL,
} from "../../domain/integration/integrationLayer";

describe("RC-4.4.1 — Ontology Integration Layer", () => {

  // ─── Part 1 — Semantic Link Types ───────────────────────────────────────────
  describe("Tipos de ligação semântica", () => {
    it("os 14 tipos declaram descrição/direção/cardinalidade/navegabilidade/peso", () => {
      expect(ALL_SEMANTIC_LINK_TYPE_IDS).toHaveLength(14);
      for (const id of ALL_SEMANTIC_LINK_TYPE_IDS) {
        const t = SEMANTIC_LINK_TYPES[id];
        for (const f of ["name", "description", "direction", "cardinality", "navigable", "weight"]) expect(t, `${id}.${f}`).toHaveProperty(f);
        expect(ALL_LINK_DIRECTIONS).toContain(t.direction);
        expect(ALL_LINK_CARDINALITIES).toContain(t.cardinality);
        expect(t.weight).toBeGreaterThan(0);
      }
    });
  });

  // ─── Part 2/8 — Links + Explainability ──────────────────────────────────────
  describe("Ligações entre ontologias (explicáveis)", () => {
    it("toda ligação tem origem/destino válidos, tipo, motivo e categoria (nada implícito)", () => {
      expect(SEMANTIC_LINKS.length).toBeGreaterThan(0);
      for (const l of SEMANTIC_LINKS) {
        expect(refExists(l.from), `origem ${l.from.domain}:${l.from.kind}:${l.from.id}`).toBe(true);
        expect(refExists(l.to), `destino ${l.to.domain}:${l.to.kind}:${l.to.id}`).toBe(true);
        expect(l.reason.length).toBeGreaterThan(0);
        expect(l.category.length).toBeGreaterThan(0);
        expect(ALL_SEMANTIC_LINK_TYPE_IDS).toContain(l.linkType);
      }
    });

    it("liga papéis/objetos/estados/eventos (operacional) a conceitos (jurídico)", () => {
      const domainsFrom = new Set(SEMANTIC_LINKS.map(l => `${l.from.domain}:${l.from.kind}`));
      for (const k of ["operating:role", "operating:object", "operating:state", "operating:event"]) expect(domainsFrom).toContain(k);
      const legalTo = SEMANTIC_LINKS.some(l => l.to.domain === "legal" && l.to.kind === "concept");
      expect(legalTo).toBe(true);
    });
  });

  // ─── Part 5 — Consultas semânticas ──────────────────────────────────────────
  describe("Consultas semânticas", () => {
    it("conceptsForObject / objectsForConcept / eventsForConcept / rolesForConcept", () => {
      expect(conceptsForObject("tr")).toEqual(expect.arrayContaining(["requisito", "criterio"]));
      expect(objectsForConcept("competencia")).toEqual(expect.arrayContaining(["edital", "processo"]));
      expect(eventsForConcept("procedimento")).toContain("sessao");
      expect(rolesForConcept("competencia")).toContain("agente_contratacao");
      expect(statesForConcept("excecao")).toContain("cancelado");
      expect(linksByType("materializa").length).toBeGreaterThan(0);
      expect(linksFor({ domain: "operating", kind: "object", id: "contrato" }).length).toBeGreaterThan(0);
    });
  });

  // ─── Part 4 — Cross references ──────────────────────────────────────────────
  describe("Cross references", () => {
    it("operatingCrossRef conhece conceitos/estruturas/classificações do objeto", () => {
      const cr = operatingCrossRef("tr");
      expect(cr.concepts.length).toBeGreaterThan(0);
      expect(cr.structures).toContain("artigo");
    });
    it("legalCrossRef conhece objetos/papéis/eventos/estados do conceito", () => {
      const cr = legalCrossRef("obrigacao");
      expect(cr.objects.length + cr.events.length).toBeGreaterThan(0);
      for (const f of ["objects", "roles", "events", "states"]) expect(cr).toHaveProperty(f);
    });
  });

  // ─── Part 3 — Mapa semântico ────────────────────────────────────────────────
  describe("Mapa semântico", () => {
    it("os mapas declaram caminhos com nós válidos das duas ontologias", () => {
      expect(SEMANTIC_MAPS.length).toBeGreaterThan(0);
      for (const m of SEMANTIC_MAPS) {
        expect(m.path.length).toBeGreaterThan(1);
        for (const n of m.path) expect(refExists(n), `${m.id}: ${n.domain}:${n.kind}:${n.id}`).toBe(true);
      }
      expect(SEMANTIC_MAPS.find(m => m.id === "tr_map")!.path[0]).toEqual({ domain: "operating", kind: "object", id: "tr" });
    });
  });

  // ─── Part 6 — Projeção Knowledge Graph ──────────────────────────────────────
  describe("Projeção Knowledge Graph", () => {
    it("nós e arestas com pesos/categorias, determinísticos, sem referência quebrada", () => {
      const nodes = toIntegrationNodes();
      const edges = toIntegrationEdges();
      const nodeIds = new Set(nodes.map(n => n.id));
      for (const e of edges) { expect(nodeIds.has(e.from)).toBe(true); expect(nodeIds.has(e.to)).toBe(true); expect(e.weight).toBeGreaterThan(0); }
      expect(edges.length).toBe(SEMANTIC_LINKS.length);
      expect(toIntegrationNodes()).toEqual(nodes);
      expect(toIntegrationEdges()).toEqual(edges);
    });
  });

  // ─── Part 9 — Validação de consistência ─────────────────────────────────────
  describe("Consistência (sem órfãs/quebradas/duplicadas/circulares) + determinismo", () => {
    it("validateIntegrationLayer é válido (zero erros)", () => {
      const v = validateIntegrationLayer();
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("ids de ligação são únicos", () => {
      expect(new Set(ALL_LINK_IDS).size).toBe(ALL_LINK_IDS.length);
    });
    it("fingerprint determinístico + modelo único agrega tipos/links/mapas", () => {
      expect(integrationFingerprint()).toBe(integrationFingerprint());
      expect(integrationFingerprint()).toHaveLength(20);
      for (const k of ["linkTypes", "links", "maps"]) expect(ONTOLOGY_INTEGRATION_MODEL).toHaveProperty(k);
    });
  });

  // ─── Baixo acoplamento: ontologias não dependem da integração ───────────────
  describe("Baixo acoplamento (ontologias permanecem independentes)", () => {
    it("nem a ontologia operacional nem a jurídica importam a camada de integração", () => {
      const fs = require("fs");
      const walk = (dir: string): string[] => fs.readdirSync(dir).flatMap((e: string) => {
        const full = `${dir}/${e}`; return fs.statSync(full).isDirectory() ? walk(full) : [full];
      });
      const files = [...walk("server/domain/institutional"), ...walk("server/domain/legal")].filter(f => f.endsWith(".ts"));
      for (const f of files) {
        const src = fs.readFileSync(f, "utf-8");
        expect(src, `${f} importa a integração`).not.toMatch(/from ["'].*integration\//);
      }
    });
  });
});
