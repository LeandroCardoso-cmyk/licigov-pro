/**
 * PR C — Governança Cognitiva e Documental (unit/behavioral, sem DB).
 *
 * Cobre, sem depender de MySQL:
 *  - Ledger de governança gravado pelo gateway canônico (executeCognitiveTask, provider mock):
 *    ator, operação, módulo, provider/model, hashes de input/output, estado de revisão,
 *    ausência de chain-of-thought e pré-visualização governada (bounded).
 *  - Segregação de deveres (assertInstitutionalDecisionRules): reviewer≠autor, aprovador humano,
 *    justificativa obrigatória em rejeição/devolução.
 *  - CATMAT/CATSER: proveniência (source) e sinal explícito "sem correspondência segura"
 *    (nunca fabrica código).
 *
 * A idempotência ponta a ponta (replay/conflito/concorrência) é coberta contra MySQL real
 * em `prc-idempotency-mysql-smoke.test.ts` (roda no CI).
 */

import { describe, it, expect } from "vitest";

import { executeCognitiveTask, type CognitiveTaskInput } from "../../services/aiExecutionEngine";
import { assertInstitutionalDecisionRules } from "../../services/documentWorkflowService";
import {
  rankCATMAT,
  manualMatch,
  assessMatchSafety,
  DEFAULT_MIN_SAFE_SCORE,
  type CATMATMatch,
} from "../../domain/catmatMatching";

const ORG = 91100;
const USER = "7";
const CORR = "corr-prc-gov";

const input = (over: Partial<CognitiveTaskInput> = {}): CognitiveTaskInput => ({
  task: "GENERATE_DOCUMENT",
  tenantId: ORG,
  userId: USER,
  correlationId: CORR,
  query: "Estruturar o próximo passo do processo licitatório.",
  ...over,
});

describe("PR C — Ledger de governança cognitiva (gateway canônico)", () => {
  it("persiste metadados de governança tenant-aware na observabilidade da execução", async () => {
    const exec = await executeCognitiveTask(input());
    const gov = exec.observability.governance;

    expect(gov).toBeDefined();
    expect(gov.actorUserId).toBe(USER);
    expect(gov.operation).toBe("GENERATE_DOCUMENT");
    expect(gov.module).toBe("unspecified"); // businessDomain não informado
    expect(gov.provider).toBeTruthy();
    expect(gov.model).toBeTruthy();
    expect(gov.reviewState).toBe("pending_human_review");
    expect(gov.error).toBeNull();
  });

  it("grava hashes de integridade de input e output (SHA-256, 64 hex)", async () => {
    const exec = await executeCognitiveTask(input({ correlationId: "corr-prc-hash" }));
    const gov = exec.observability.governance;
    expect(gov.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(gov.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(gov.inputChars).toBeGreaterThanOrEqual(0);
    expect(gov.outputChars).toBeGreaterThanOrEqual(0);
  });

  it("NÃO persiste chain-of-thought e limita a pré-visualização governada", async () => {
    const exec = await executeCognitiveTask(input({ correlationId: "corr-prc-cot" }));
    const gov = exec.observability.governance;
    // Nenhuma chave de raciocínio privado/bruto no registro de governança.
    for (const forbidden of ["chainOfThought", "reasoningTrace", "rawReasoning", "cot"]) {
      expect(Object.prototype.hasOwnProperty.call(gov, forbidden)).toBe(false);
    }
    // Pré-visualização governada é bounded (nunca expõe conteúdo sensível integral).
    expect(gov.inputPreview.length).toBeLessThanOrEqual(320);
    expect(gov.outputPreview.length).toBeLessThanOrEqual(320);
  });
});

describe("PR C — Segregação de deveres (aprovações institucionais)", () => {
  it("bloqueia o autor de aprovar o próprio documento (reviewer ≠ autor)", () => {
    expect(() =>
      assertInstitutionalDecisionRules({ toState: "approved", actorUserId: 5, authorUserId: 5, reason: null }),
    ).toThrow(/autor.*não pode aprová-lo|revisor distinto/i);
  });

  it("permite aprovação por revisor distinto do autor", () => {
    expect(() =>
      assertInstitutionalDecisionRules({ toState: "approved", actorUserId: 6, authorUserId: 5, reason: null }),
    ).not.toThrow();
  });

  it("exige aprovador humano identificado (IA/sistema não aprova)", () => {
    expect(() =>
      assertInstitutionalDecisionRules({ toState: "approved", actorUserId: 0, authorUserId: 5, reason: null }),
    ).toThrow(/revisor humano identificado/i);
  });

  it("exige justificativa não-vazia em rejeição e devolução", () => {
    expect(() =>
      assertInstitutionalDecisionRules({ toState: "rejected", actorUserId: 6, authorUserId: 5, reason: "  " }),
    ).toThrow(/justificativa obrigatória/i);
    expect(() =>
      assertInstitutionalDecisionRules({ toState: "draft", actorUserId: 6, authorUserId: 5, reason: null }),
    ).toThrow(/justificativa obrigatória/i);
    expect(() =>
      assertInstitutionalDecisionRules({ toState: "rejected", actorUserId: 6, authorUserId: 5, reason: "fora do padrão" }),
    ).not.toThrow();
  });
});

describe("PR C — CATMAT/CATSER supervisionado (proveniência + sem correspondência segura)", () => {
  const rank = (over: Partial<Parameters<typeof rankCATMAT>[0]> = {}) =>
    rankCATMAT({
      itemId: "item-1",
      organizationId: ORG,
      description: "caneta esferográfica azul",
      candidates: [
        { code: "111111", description: "caneta esferográfica azul" },
        { code: "222222", description: "lápis preto nº 2" },
      ],
      correlationId: CORR,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...over,
    });

  it("anexa proveniência (source) às sugestões — nunca em branco", () => {
    const matches = rank();
    expect(matches.every((m) => !!m.source)).toBe(true);
    expect(matches[0].source).toBe("catalogo-interno");
    expect(rank({ defaultSource: "api-comprasgov" })[0].source).toBe("api-comprasgov");
    expect(manualMatch({ itemId: "i", organizationId: ORG, catmatCode: "999", catmatDescription: "x", correlationId: CORR }).source).toBe("manual");
  });

  it("sinaliza 'sem correspondência segura' quando não há candidatos (não fabrica código)", () => {
    const a = assessMatchSafety([], DEFAULT_MIN_SAFE_SCORE);
    expect(a.safe).toBe(false);
    expect(a.reason).toBe("no_candidates");
    expect(a.best).toBeNull();
  });

  it("sinaliza 'sem correspondência segura' quando o melhor score está abaixo do limiar", () => {
    const matches = rank({ description: "objeto totalmente distinto sem relação alguma" });
    const a = assessMatchSafety(matches, 0.9);
    expect(a.safe).toBe(false);
    expect(a.reason).toBe("below_threshold");
    // Ainda expõe o melhor candidato para revisão humana, mas NÃO o marca como confirmado.
    expect(a.best).not.toBeNull();
    expect((a.best as CATMATMatch).decision).toBe("sugerido");
  });

  it("confirma correspondência segura acima do limiar", () => {
    const matches = rank();
    const a = assessMatchSafety(matches, DEFAULT_MIN_SAFE_SCORE);
    expect(a.safe).toBe(true);
    expect(a.reason).toBe("safe_match");
    expect((a.best as CATMATMatch).catmatCode).toBe("111111");
  });
});
