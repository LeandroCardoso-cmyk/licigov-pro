/**
 * LICIGOV-FAST S1/S2/S3 — mensagens melhores SEM afrouxar nenhum bloqueio.
 *  - S1: marcadores `[REVISAR]` classificados por origem; o critério de bloqueio da emissão continua `countReviewMarkers > 0`.
 *  - S2: a nota do documento anterior não injeta marcador de revisão no prompt (coberto em r9-sem039-047).
 *  - S3: falta de itens/quantidade é "informação pendente", mas a recusa da fonte (HD-01) é a mesma.
 */
import { describe, it, expect } from "vitest";
import {
  classifyReviewMarkers, countReviewMarkers, emissionBlockers, reviewMarkersMessage, type EmissionPreconditionInput,
} from "../../domain/emissionPreconditions";
import { MISSING_VALUE_MARK, PENDING_AI_SLOT_MARK } from "../../domain/institutionalTemplates/composerShared";
import { UNVERIFIED_AMOUNT_MARK } from "../../domain/aiNumericAuthority";
import { FICTITIOUS_PRICE_CELL_TEXT, QUANTITY_NOT_INFORMED_TEXT, fictitiousQuotesReviewText } from "../../domain/authoritativeItems";
import {
  TEMPLATE_SOURCE_UNAVAILABLE, TemplateSourceIncompleteError, TemplateSourceUnavailableError,
} from "../../services/institutionalTemplates/ports";

const base: EmissionPreconditionInput = {
  kind: "tr", content: "", contentHash: "h", sourceState: "current", changedSourceLabels: [], trEmitted: true,
  lastEmittedContentHash: null, lastEmittedVersion: null,
};

describe("S1 — classificação dos marcadores [REVISAR] (apresentação)", () => {
  it("classifica pelos PRODUTORES reais do sistema e diz onde resolver", () => {
    const content = [
      MISSING_VALUE_MARK("contratacao.prazoExecucao"),
      PENDING_AI_SLOT_MARK("justificativa"),
      UNVERIFIED_AMOUNT_MARK,
      FICTITIOUS_PRICE_CELL_TEXT,
      QUANTITY_NOT_INFORMED_TEXT,
      "[REVISAR: fonte da pesquisa alterada após a decisão]",
      "[REVISAR: decisão/análise necessária — forma de pagamento]",
      "[REVISAR]",
    ].join("\n");
    const s = classifyReviewMarkers(content);
    expect(s.total).toBe(countReviewMarkers(content));
    expect(s.byCategory).toEqual({
      missing_info: 2, ai_narrative_pending: 1, amount_unverified: 1, reference_price: 1, source_changed: 1, ai_gap: 1, generic: 1,
    });
    expect(s.resolveAt).toEqual(expect.arrayContaining(["Itens da contratação", "Pesquisa de Preços", "dados do processo usados pelo modelo institucional"]));
    const msg = reviewMarkersMessage(s);
    expect(msg).toContain("8 marcador(es) [REVISAR]");
    expect(msg).toContain("2 informação(ões) ainda não informada(s)");
    expect(msg).toContain("1 trecho(s) gerado(s) com IA aguardando revisão humana");
    expect(msg).toContain("apagar o marcador não resolve a pendência de origem");
  });

  it("o total é SEMPRE o da contagem do bloqueio (inclusive marcadores aninhados ou sem fechamento)", () => {
    for (const c of ["a [REVISAR: x [REVISAR: y] b", "[REVISAR: sem fechamento\n[REVISAR]", fictitiousQuotesReviewText(3), "nada"]) {
      expect(classifyReviewMarkers(c).total).toBe(countReviewMarkers(c));
    }
  });

  it("texto livre da IA (inclusive imitando um produtor) não ganha 'onde resolver' falso", () => {
    for (const text of ["[REVISAR: confirmar com o setor requisitante]", "[REVISAR: prazo de garantia não informado]", '[REVISAR: narrativa "x" pendente]']) {
      const s = classifyReviewMarkers(text);
      expect(s.byCategory, text).toEqual({ ai_gap: 1 });
      expect(s.resolveAt, text).toEqual([]);
    }
  });

  it("NÃO REGRESSÃO: qualquer categoria continua bloqueando a emissão com o MESMO código", () => {
    for (const c of [MISSING_VALUE_MARK("x"), PENDING_AI_SLOT_MARK("s"), UNVERIFIED_AMOUNT_MARK, "[REVISAR: qualquer]", "[REVISAR]"]) {
      const b = emissionBlockers({ ...base, content: `texto ${c}` });
      expect(b.map((x) => x.code)).toEqual(["EMISSION_REVIEW_MARKERS"]);
      expect(b[0].details?.reviewMarkers.total).toBe(1);
    }
  });

  it("NÃO REGRESSÃO: remover o marcador de preço fictício do texto NÃO libera a emissão (bloqueio vem das fontes)", () => {
    const b = emissionBlockers({ ...base, content: "texto limpo", fictitiousPriceItemCount: 2 });
    expect(b.map((x) => x.code)).toEqual(["EMISSION_FICTITIOUS_PRICES"]);
  });

  it("NÃO REGRESSÃO: narrativa de IA nunca é considerada resolvida por estar classificada", () => {
    const b = emissionBlockers({ ...base, content: PENDING_AI_SLOT_MARK("fundamentacao") });
    expect(b).toHaveLength(1);
    expect(b[0].details?.reviewMarkers.byCategory).toEqual({ ai_narrative_pending: 1 });
  });

  it("sem marcador ⇒ sem bloqueio nem detalhes (comportamento anterior)", () => {
    expect(emissionBlockers({ ...base, content: "TR limpo" })).toEqual([]);
  });
});

describe("S3 — falta de informação ≠ falha técnica da fonte (mesma recusa)", () => {
  it("TemplateSourceIncompleteError continua sendo TemplateSourceUnavailableError (todo catch existente recusa igual)", () => {
    const e = new TemplateSourceIncompleteError("ITEMS", "CANONICAL_ITEMS_REQUIRED", "Ainda não existem itens cadastrados para esta contratação.");
    expect(e).toBeInstanceOf(TemplateSourceUnavailableError);
    expect(e.kind).toBe("INCOMPLETE");
    expect(e.message).toBe(`${TEMPLATE_SOURCE_UNAVAILABLE}: ITEMS — CANONICAL_ITEMS_REQUIRED: Ainda não existem itens cadastrados para esta contratação.`);
  });
  it("falhas técnicas/integridade/escopo seguem UNAVAILABLE", () => {
    const e = new TemplateSourceUnavailableError("ITEMS", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
    expect(e.kind).toBe("UNAVAILABLE");
    expect(e).not.toBeInstanceOf(TemplateSourceIncompleteError);
  });
});
