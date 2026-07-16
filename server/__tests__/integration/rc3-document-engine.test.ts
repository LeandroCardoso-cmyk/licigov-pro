import { describe, it, expect } from "vitest";

// Domain
import {
  createOfficialDocument, computeLineageId, computeReplayHash, officialFilename,
  OFFICIAL_FORMATS,
} from "../../domain/officialDocument";
// Service (Document Engine)
import {
  generateOfficialDocument, renderOfficialDocument, previewOfficialDocument,
  listOfficialDocuments,
} from "../../services/documentEngineService";
// Persistence (degrada sem DB)
import { insertOfficialDocument, getOfficialDocument, listVersions } from "../../db/officialDocuments";
// Real converters (binário)
import { convertToPDF, convertToDOCX } from "../../services/documentConverter";
// Arquitetura
import { getBusinessDomainDefinition } from "../../domain/businessDomain";
import { checkKernelAccess } from "../../services/kernelAccessService";
import { documentEngineRouter } from "../../routers/documentEngineRouter";

const ORG = 11200;
const CORR = "corr-rc3";

describe("RC-3 — Official Document Engine", () => {

  // ─── Modelo uniforme ────────────────────────────────────────────────────────

  describe("OfficialDocument (modelo uniforme)", () => {
    const mk = (version = 1) => createOfficialDocument({
      tenantId: ORG, businessDomain: "contratos", documentType: "contrato", origin: "ws-1",
      title: "Contrato X", content: "# Contrato\nConteúdo", version, author: "7", correlationId: CORR,
    });

    it("id determinístico por linhagem+versão; replayHash e lineage estáveis", () => {
      const a = mk(1); const b = mk(1);
      expect(a.id).toBe(b.id);
      expect(a.lineageId).toBe(b.lineageId);
      expect(a.replayHash).toBe(b.replayHash);
      expect(mk(2).id).not.toBe(a.id); // versão diferente → id diferente
      expect(mk(2).lineageId).toBe(a.lineageId); // mesma linhagem
    });

    it("possui todos os campos uniformes exigidos", () => {
      const d = mk();
      for (const f of ["id", "tenantId", "businessDomain", "documentType", "origin", "title", "version", "status", "template", "content", "metadata", "author", "lineageId", "correlationId", "replayHash", "createdAt", "updatedAt"]) {
        expect(d, `campo ausente: ${f}`).toHaveProperty(f);
      }
      expect(d.status).toBe("gerado");
      expect(d.template).toBe("contratos_contrato");
    });

    it("nome de arquivo canônico por formato", () => {
      expect(officialFilename(mk(), "docx")).toMatch(/\.docx$/);
      expect(officialFilename(mk(), "pdf")).toMatch(/\.pdf$/);
      expect(OFFICIAL_FORMATS).toEqual(["docx", "pdf"]);
    });

    it("multi-tenant: linhagem isolada por tenant", () => {
      const other = computeLineageId({ tenantId: ORG + 1, businessDomain: "contratos", documentType: "contrato", origin: "ws-1" });
      expect(other).not.toBe(mk().lineageId);
    });
  });

  // ─── Render DOCX/PDF reais (binário) ────────────────────────────────────────

  describe("exportação DOCX/PDF (binário real)", () => {
    const MD = "# Documento Oficial\n\nParágrafo de teste com **conteúdo**.\n\n- item 1\n- item 2";
    it("convertToDOCX gera um .docx real (assinatura ZIP PK)", async () => {
      const buf = await convertToDOCX(MD, "teste.docx");
      expect(buf.length).toBeGreaterThan(0);
      expect(buf.slice(0, 2).toString("latin1")).toBe("PK"); // DOCX é um ZIP
    });
    it("convertToPDF gera um .pdf real (assinatura %PDF)", async () => {
      const buf = await convertToPDF(MD, "teste.pdf");
      expect(buf.length).toBeGreaterThan(0);
      expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");
    });
  });

  // ─── Serviço: pipeline (gera, versiona sem DB, exporta) ─────────────────────

  describe("Document Engine service", () => {
    it("gera documento oficial pelo pipeline (Kernel-gated) mesmo sem DB", async () => {
      const doc = await generateOfficialDocument({
        organizationId: ORG, businessDomain: "processo_licitatorio", documentType: "etp",
        origin: "proc-1", title: "ETP — Objeto", content: "# ETP\nfundamentação", author: "1", correlationId: CORR,
      });
      expect(doc.businessDomain).toBe("processo_licitatorio");
      expect(doc.documentType).toBe("etp");
      expect(doc.version).toBe(1);
      expect(doc.replayHash.length).toBe(32);
    });

    it("exporta um documento oficial existente (DOCX/PDF); erro claro se não existir", async () => {
      // sem DB, getOfficialDocument retorna null → erro de não encontrado
      await expect(renderOfficialDocument({ organizationId: ORG, documentId: "inexistente", format: "docx" }))
        .rejects.toThrow("não encontrado");
    });

    it("preview e list degradam sem DB", async () => {
      expect((await previewOfficialDocument({ organizationId: ORG, documentId: "x" })).document).toBeNull();
      expect(await listOfficialDocuments(ORG)).toEqual([]);
    });
  });

  // ─── Persistência degrada sem DB ────────────────────────────────────────────

  describe("persistência (degrada sem DB)", () => {
    it("insert retorna null; get e versions vazios", async () => {
      const d = createOfficialDocument({ tenantId: ORG, businessDomain: "contratos", documentType: "contrato", origin: "ws-9", title: "X", content: "c", version: 1, author: "1", correlationId: CORR });
      expect(await insertOfficialDocument(d)).toBeNull();
      expect(await getOfficialDocument(d.id, ORG)).toBeNull();
      expect(await listVersions(d.lineageId, ORG)).toEqual([]);
    });
  });

  // ─── Integração: todos os domínios usam o Document Engine ───────────────────

  describe("integração com os Business Domains", () => {
    it("Document Engine registrado como router oficial", () => {
      const procedures = Object.keys(documentEngineRouter._def.procedures);
      for (const ep of ["generate", "get", "list", "versions", "timeline", "preview", "download"]) {
        expect(procedures).toContain(ep);
      }
    });

    it("os 4 domínios que geram documentos declaram document_engine no Kernel", () => {
      for (const d of ["processo_licitatorio", "contratacao_direta", "parecer_juridico", "contratos"] as const) {
        expect(checkKernelAccess(d, "document_engine").allowed, `${d} sem document_engine`).toBe(true);
        expect(getBusinessDomainDefinition(d).requiredKernelServices).toContain("document_engine");
      }
    });

    it("os serviços de domínio delegam ao Document Engine (import do pipeline único)", async () => {
      const fs = await import("fs");
      for (const svc of ["contractService", "procurementProcessService", "directProcurementService", "legalOpinionWorkspaceService"]) {
        const src = fs.readFileSync(`server/services/${svc}.ts`, "utf-8");
        expect(src, `${svc} não delega ao Document Engine`).toContain("generateOfficialDocument");
      }
    });
  });
});
