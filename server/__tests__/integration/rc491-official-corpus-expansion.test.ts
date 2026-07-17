/**
 * RC-4.9.1 — Official Knowledge Corpus · Expansão (Prejulgado nº 27 + Lei Municipal 769/2021)
 *
 * Valida que o Official Knowledge Corpus CRESCE usando exclusivamente a infraestrutura da RC-4.9
 * (mesmo parser, classificação, pipeline, publicação): incorpora dois documentos oficiais REAIS —
 * Prejulgado nº 27 (TCE-PR, estadual) e Lei Municipal 769/2021 (Moreira Sales, municipal). SEM novos
 * frameworks/serviços. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import { buildOfficialKnowledgeCorpus, MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import {
  findByEsfera, findByType, findByTenant, findByState, resolveContext, buildOfficialCorpora,
} from "../../domain/officialCorpus/officialCorpusRegistry";
import { explainOfficialDocument } from "../../domain/officialCorpus/officialCorpusExplainability";
import { allBlocks } from "../../domain/knowledge/knowledgeDocument";

const RESULT = buildOfficialKnowledgeCorpus({ correlationId: "rc491-suite" });
const prejulgado = () => RESULT.ingested.find(d => d.official.normId === "prejulgado-27-tce-pr")!;
const leiMunicipal = () => RESULT.ingested.find(d => d.official.normId === "lei-municipal-769-2021-moreira-sales")!;

describe("RC-4.9.1 — Official Knowledge Corpus · Expansão", () => {

  // ─── Documento 1 — Prejulgado nº 27 (TCE-PR) ────────────────────────────────
  describe("Prejulgado nº 27 (TCE-PR, estadual)", () => {
    it("foi ingerido, classificado e publicado", () => {
      const d = prejulgado();
      expect(d).toBeTruthy();
      expect(d.official.documentType).toBe("prejulgado");
      expect(d.official.authority).toBe("TCE-PR");
      expect(d.official.jurisdiction).toBe("estadual");
      expect(d.official.state).toBe("PR");
      expect(d.official.bindingLevel).toBe("prejulgado_tce");
      expect(d.official.status).toBe("vigente");
      expect(d.publication.published).toBe(true);
      expect(d.execution.execution.status).toBe("completed");
      // conteúdo verbatim real presente
      const txt = allBlocks(d.knowledgeDocument).filter(b => b.kind === "OfficialText").map(b => b.fragments[0].text).join(" ");
      expect(txt).toMatch(/microempresas|pequeno porte|Administração/i);
    });
  });

  // ─── Documento 2 — Lei Municipal nº 769/2021 (Moreira Sales) ────────────────
  describe("Lei Municipal nº 769/2021 (Moreira Sales, municipal)", () => {
    it("foi ingerida, classificada e publicada com tenant municipal", () => {
      const d = leiMunicipal();
      expect(d).toBeTruthy();
      expect(d.official.documentType).toBe("municipal_law");
      expect(d.official.authority).toBe("Município de Moreira Sales");
      expect(d.official.jurisdiction).toBe("municipal");
      expect(d.official.state).toBe("PR");
      expect(d.official.municipality).toBe("Moreira Sales");
      expect(d.official.tenantId).toBe(MOREIRA_SALES_TENANT_ID);
      expect(d.official.bindingLevel).toBe("mandatory");
      expect(d.official.effectiveDate).toBe("2021-03-03");
      expect(d.publication.published).toBe(true);
      // hierarquia normativa com artigos (Art. 1º…10)
      expect(d.normativeTree!.nodes.length).toBeGreaterThanOrEqual(10);
      // conteúdo verbatim real (texto da lei)
      const txt = allBlocks(d.knowledgeDocument).filter(b => b.kind === "OfficialText").map(b => b.fragments[0].text).join(" ");
      expect(txt).toMatch(/microempresas|pequeno porte|Moreira Sales/i);
    });
  });

  // ─── Versionamento & Metadados & Explainability & Lineage ───────────────────
  describe("Versionamento, metadados, explainability e lineage", () => {
    it("ambos possuem versionamento, publicação com checksum, explainability e lineage", () => {
      for (const d of [prejulgado(), leiMunicipal()]) {
        expect(d.official.version).toBe("1.0.0");
        expect(d.publication.snapshot!.version.semver).toBe("1.0.0");
        expect(d.publication.snapshot!.manifest.checksum.length).toBeGreaterThan(0);
        expect(d.knowledgeDocument.lineageId.length).toBeGreaterThan(0);
        const ex = explainOfficialDocument(d);
        expect(ex.publication.published).toBe(true);
        expect(ex.pipeline.gatesPassed).toBe(true);
        expect(ex.origin.authority.length).toBeGreaterThan(0);
      }
    });
    it("determinismo: reincorporação → mesmos ids/replayHash", () => {
      const again = buildOfficialKnowledgeCorpus({ correlationId: "rc491-again" });
      const a = again.ingested.find(d => d.official.normId === "lei-municipal-769-2021-moreira-sales")!;
      expect(a.official.documentId).toBe(leiMunicipal().official.documentId);
      expect(a.knowledgeDocument.replayHash).toBe(leiMunicipal().knowledgeDocument.replayHash);
    });
  });

  // ─── Hierarquia — Federal inalterado; Paraná +1; Moreira Sales +1 ───────────
  describe("Hierarquia (Federal → Paraná → Moreira Sales)", () => {
    it("contagens por esfera após expansão", () => {
      expect(RESULT.counts.federal).toBe(5);       // Federal inalterado
      expect(RESULT.counts.parana).toBe(2);        // Manual TCE-PR + Prejulgado 27
      expect(RESULT.counts.moreiraSales).toBe(1);  // Lei Municipal 769
    });
    it("cada documento na camada correta", () => {
      expect(findByType(RESULT.registry, "prejulgado").map(d => d.jurisdiction)).toEqual(["estadual"]);
      expect(findByType(RESULT.registry, "municipal_law").map(d => d.jurisdiction)).toEqual(["municipal"]);
      // Prejulgado pertence ao Paraná (state PR, estadual); Lei ao tenant municipal
      expect(findByState(RESULT.registry, "PR").some(d => d.normId === "prejulgado-27-tce-pr")).toBe(true);
      expect(findByTenant(RESULT.registry, MOREIRA_SALES_TENANT_ID).map(d => d.normId)).toEqual(["lei-municipal-769-2021-moreira-sales"]);
      // Federal permanece intacto (5 documentos federais)
      expect(findByEsfera(RESULT.registry, "federal")).toHaveLength(5);
    });
    it("resolveContext para Moreira Sales: federal precede; estadual + municipal complementam", () => {
      const ctx = resolveContext(RESULT.registry, { state: "PR", tenantId: MOREIRA_SALES_TENANT_ID, municipality: "Moreira Sales" });
      expect(ctx.documents[0].jurisdiction).toBe("federal");
      expect(ctx.documents.some(d => d.normId === "prejulgado-27-tce-pr")).toBe(true);
      expect(ctx.documents.some(d => d.normId === "lei-municipal-769-2021-moreira-sales")).toBe(true);
      // corpora encadeados Federal → Paraná → Moreira Sales
      const [federal, parana, moreira] = buildOfficialCorpora(MOREIRA_SALES_TENANT_ID);
      expect(parana.parentId).toBe(federal.id);
      expect(moreira.parentId).toBe(parana.id);
    });
  });
});
