/**
 * RC-4.9 — Official Knowledge Corpus · Builder (Fases 1-4).
 *
 * Lê os TEXTOS OFICIAIS em `data/` e os incorpora nas 3 esferas (Federal, Paraná, Moreira Sales)
 * usando exclusivamente os frameworks existentes. Registra corpora + hierarquia de tenant, roda o
 * Institutional Knowledge Pipeline e publica. NÃO usa IA/RAG/chat. Determinístico.
 *
 * Moreira Sales: o tenant e o corpus são registrados e PREPARADOS; nenhum documento municipal é
 * fabricado — só serão incorporados quando fontes oficiais municipais estiverem disponíveis.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseOfficialText, chunkText } from "./officialTextParser";
import { ingestNorm, ingestChunkedDocument, type IngestedDocument } from "../../domain/officialCorpus/officialCorpusIngestion";
import { buildOfficialCorpora, createOfficialCorpusRegistry, addOfficialDocument, type OfficialCorpusRegistry } from "../../domain/officialCorpus/officialCorpusRegistry";
import type { CreateOfficialDocumentParams } from "../../domain/officialCorpus/officialDocument";
import { recordOfficialCorpusEvent } from "../knowledge/officialCorpusObservabilityService";

export const MOREIRA_SALES_TENANT_ID = 700001;

interface SourceSpec {
  file: string;
  chunked?: boolean;
  buildTree?: boolean;
  /** Título oficial explícito (usado p/ manuais cujo cabeçalho não traz linha de título). */
  title?: string;
  classification: Omit<CreateOfficialDocumentParams, "title" | "knowledgeDocumentId">;
}

/** Documentos oficiais prioritários (fontes reais em `data/`). */
const SOURCES: SourceSpec[] = [
  // ── FASE 1/2 — FEDERAL ──────────────────────────────────────────────────────
  { file: "lei_14133_2021.txt", buildTree: true, classification: { normId: "lei-14133-2021", documentType: "lei", authority: "Congresso Nacional", jurisdiction: "federal", effectiveDate: "2021-04-01", source: "planalto.gov.br", version: "1.0.0", status: "vigente" } },
  { file: "decreto_11462_2023.txt", classification: { normId: "decreto-11462-2023", documentType: "decreto", authority: "Presidência da República", jurisdiction: "federal", effectiveDate: "2023-03-31", source: "planalto.gov.br", version: "1.0.0", status: "vigente" } },
  { file: "in_seges_65_2021.txt", classification: { normId: "in-seges-65-2021", documentType: "instrucao_normativa", authority: "SEGES/ME", jurisdiction: "federal", effectiveDate: "2021-07-08", source: "in.gov.br", version: "1.0.0", status: "vigente" } },
  { file: "lc_123_2006.txt", classification: { normId: "lc-123-2006", documentType: "lei_complementar", authority: "Congresso Nacional", jurisdiction: "federal", effectiveDate: "2006-12-15", source: "planalto.gov.br", version: "1.0.0", status: "vigente" } },
  { file: "manual_tcu_5ed.txt", chunked: true, title: "Licitações e Contratos — Orientações e Jurisprudência do TCU (5ª ed.)", classification: { normId: "manual-tcu-licitacoes-5ed", documentType: "manual", authority: "Tribunal de Contas da União", jurisdiction: "federal", source: "portal.tcu.gov.br", version: "5.0.0", status: "vigente" } },
  // ── FASE 3 — ESTADO DO PARANÁ ────────────────────────────────────────────────
  { file: "manual_tce_pr.txt", chunked: true, title: "Orientações Técnicas do TCE-PR — Licitações e Contratos", classification: { normId: "manual-tce-pr", documentType: "orientacao_tecnica", authority: "TCE-PR", jurisdiction: "estadual", state: "PR", source: "tce.pr.gov.br", version: "1.0.0", status: "vigente", bindingLevel: "orientacao" } },
  // RC-4.9.1 — Prejulgado nº 27 (TCE-PR).
  { file: "prejulgado_27_tce_pr.txt", chunked: true, title: "Prejulgado nº 27 — Tribunal de Contas do Estado do Paraná", classification: { normId: "prejulgado-27-tce-pr", documentType: "prejulgado", authority: "TCE-PR", jurisdiction: "estadual", state: "PR", source: "tce.pr.gov.br", version: "1.0.0", status: "vigente", bindingLevel: "prejulgado_tce" } },
  // ── FASE 4 — MUNICÍPIO DE MOREIRA SALES ──────────────────────────────────────
  // RC-4.9.1 — Lei Municipal nº 769/2021 (texto oficial via OCR do PDF fornecido).
  { file: "lei_municipal_769_2021_moreira_sales.txt", buildTree: true, title: "Lei Municipal nº 769/2021 — Município de Moreira Sales", classification: { normId: "lei-municipal-769-2021-moreira-sales", documentType: "municipal_law", authority: "Município de Moreira Sales", jurisdiction: "municipal", state: "PR", municipality: "Moreira Sales", tenantId: MOREIRA_SALES_TENANT_ID, effectiveDate: "2021-03-03", source: "Prefeitura Municipal de Moreira Sales", version: "1.0.0", status: "vigente", bindingLevel: "mandatory" } },
];

export interface OfficialCorpusBuildResult {
  readonly registry: OfficialCorpusRegistry;
  readonly ingested: readonly IngestedDocument[];
  readonly counts: { readonly federal: number; readonly parana: number; readonly moreiraSales: number };
  readonly municipalTenantId: number;
}

/** Incorpora todos os documentos oficiais disponíveis. Determinístico. */
export function buildOfficialKnowledgeCorpus(params: { correlationId: string; dataDir?: string } = { correlationId: "corpus-build" }): OfficialCorpusBuildResult {
  const dataDir = params.dataDir ?? join(process.cwd(), "data");
  const correlationId = params.correlationId;

  // Corpora + hierarquia de tenant (Federal → Paraná → Moreira Sales).
  const corpora = buildOfficialCorpora(MOREIRA_SALES_TENANT_ID);
  let registry = createOfficialCorpusRegistry(corpora, []);
  for (const c of corpora) recordOfficialCorpusEvent({ correlationId, tenantId: c.tenantId || null, type: "corpusCreated", subjectId: c.id, detail: c.name, count: 1 });

  const ingested: IngestedDocument[] = [];
  for (const spec of SOURCES) {
    const path = join(dataDir, spec.file);
    if (!existsSync(path)) continue; // fonte ausente → não fabrica
    const raw = readFileSync(path, "utf8");
    let doc: IngestedDocument;
    if (spec.chunked) {
      const parsed = parseOfficialText(raw);
      doc = ingestChunkedDocument({ title: spec.title ?? parsed.title, url: parsed.url, chunks: chunkText(raw, 12000), classification: spec.classification, correlationId });
    } else {
      doc = ingestNorm({ parsed: parseOfficialText(raw), classification: spec.classification, correlationId, buildTree: spec.buildTree });
    }
    ingested.push(doc);
    registry = addOfficialDocument(registry, doc.official);
    recordOfficialCorpusEvent({ correlationId, tenantId: doc.official.tenantId, type: "documentPublished", subjectId: doc.official.documentId, detail: doc.official.title, count: doc.publication.published ? 1 : 0 });
  }

  const counts = {
    federal: ingested.filter(d => d.official.jurisdiction === "federal").length,
    parana: ingested.filter(d => d.official.jurisdiction === "estadual").length,
    // Moreira Sales: nenhum documento-fonte municipal disponível — corpus preparado, 0 documentos.
    moreiraSales: ingested.filter(d => d.official.jurisdiction === "municipal").length,
  };

  return { registry, ingested, counts, municipalTenantId: MOREIRA_SALES_TENANT_ID };
}
