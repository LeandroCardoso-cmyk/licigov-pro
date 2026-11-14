/**
 * P0 (auditoria pré-emissão H5) — a automação de homologação valida MECANISMOS e nunca se apresenta como pessoa:
 *  - texto inserido no lugar de `[REVISAR]` e motivo de emissão DECLARAM "sem revisão humana" (`MECHANISM_ONLY`);
 *  - afirmações de conferência/revisão/aprovação produzidas por automação são recusadas (BLOQUEIO, nunca PASS);
 *  - reconhecer desvio estrutural e marcar declaração pessoal ("Confirmo, como pessoa responsável…") não são praticados pela automação;
 *  - varredura estática impede que os procedimentos usados em H1–H5 voltem aos roteiros que atingem o staging.
 * Não pretende detectar automação não declarada (limite documentado no dossiê); protege os roteiros conhecidos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  BLOCKED_FICTITIOUS_HUMAN_REVIEW, MARK, MECHANISM_ONLY, MECHANISM_ONLY_EMISSION_REASON, MECHANISM_ONLY_PLACEHOLDER,
  assertNoFictitiousReviewClaim, refuseAutomatedDeviationAcknowledgement, replaceReviewMarkersForMechanismOnly, syntheticDecision,
} from "../../../scripts/homologation-e2e";
import { validateDecisionRequest } from "../../domain/institutionalDecision";

const ROOT = process.cwd();
/** Frases usadas nas homologações H1–H5 (e equivalentes) para simular revisão humana. */
const H1_H5_CLAIMS = [
  `${MARK} texto conferido na homologação.`, `${MARK} TR revisado e conferido.`, `${MARK} Edital revisado e conferido.`,
  "Observação do revisor: conteúdo conferido.", "Texto redigido e conferido pela equipe.", "Confirmo, como pessoa responsável, o REGISTRO",
  // variações apontadas pela auditoria independente (falsos negativos da 1ª versão da guarda)
  "Conferência realizada pela equipe.", "Revisão concluída.", "Revisei o texto.", "Conferi o TR.", "Verificado pela equipe.", "Documento homologado.",
  "Aprovo a minuta.", "Ratifico o ato.", "Certifico a regularidade.", "Texto validado.",
];

describe("texto produzido por automação nunca afirma revisão humana", () => {
  it("as frases das homologações H1–H5 são recusadas; o texto MECHANISM_ONLY passa", () => {
    for (const claim of H1_H5_CLAIMS) expect(() => assertNoFictitiousReviewClaim(claim, "teste"), claim).toThrow(BLOCKED_FICTITIOUS_HUMAN_REVIEW);
    for (const ok of [MECHANISM_ONLY_PLACEHOLDER, MECHANISM_ONLY_EMISSION_REASON, `${MARK} preenchimento automatizado de homologação (${MECHANISM_ONLY})`]) {
      expect(() => assertNoFictitiousReviewClaim(ok, "teste"), ok).not.toThrow();
    }
    expect(MECHANISM_ONLY_PLACEHOLDER).toMatch(/SEM REVISÃO HUMANA/);
    expect(MECHANISM_ONLY_EMISSION_REASON).toMatch(/sem revisão humana e sem aprovação/);
  });

  it("atravessar [REVISAR] só com o texto que declara a ausência de revisão; a contagem vai para o relatório", () => {
    const { content, replaced } = replaceReviewMarkersForMechanismOnly("A [REVISAR: valor não conferido] B [REVISAR] C");
    expect(replaced).toBe(2);
    expect(content).not.toMatch(/\[REVISAR/);
    expect(content.split(MECHANISM_ONLY_PLACEHOLDER)).toHaveLength(3);
    expect(content).not.toMatch(/texto conferido/);
  });

  it("reconhecimento automatizado de desvio estrutural é sempre recusado", () => {
    expect(() => refuseAutomatedDeviationAcknowledgement()).toThrow(BLOCKED_FICTITIOUS_HUMAN_REVIEW);
  });

  it("decisão sintética declara execução automatizada, sem confirmação pessoal, e respeita o vínculo autoridade × executor do ledger", () => {
    const d = syntheticDecision({ id: 9, name: "Usuária Teste" }, "2026-11-09");
    expect(d.basisReference).toMatch(/execução automatizada/);
    expect(d.basisReference).toMatch(/sem confirmação pessoal/);
    expect(d.reason).toContain(MECHANISM_ONLY);
    const base = {
      organizationId: 2, subjectType: "procurement.source_fields", subjectId: "P1", decisionType: "source_fields_declared", outcome: "declarado",
      evidence: [], expectedRevision: 0, idempotencyKey: "idem-p0-synth", correlationId: "c", ...d,
    };
    expect(validateDecisionRequest({ ...base, recordedByUserId: 9 })).toEqual({ ok: true });                       // própria identidade
    expect(validateDecisionRequest({ ...base, recordedByUserId: 10 })).toMatchObject({ ok: false, code: "DECISION_AUTHORITY_NOT_ACTOR" });
  });
});

describe("varredura estática — os procedimentos de H1–H5 não voltam aos roteiros que atingem o staging", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|mts|cts|js|cjs|mjs)$/.test(f) ? [p] : [];
  });
  const targets = [...files(path.join(ROOT, "scripts")), ...files(path.join(ROOT, "server/__tests__/homologation"))];

  it("nenhuma afirmação de conferência/revisão, nenhum reconhecimento de desvio e nenhuma declaração pessoal automatizada", () => {
    expect(targets.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of targets) {
      const src = readFileSync(f, "utf8");
      const rel = path.relative(ROOT, f);
      if (/texto conferido|revisado e conferido|conte[úu]do conferido|redigido e conferido/i.test(src)) offenders.push(`${rel}: afirmação de conferência`);
      if (/acknowledgeDeviation\s*\.\s*mutate/.test(src)) offenders.push(`${rel}: reconhecimento automatizado de desvio`);
      if (/Confirmo, como pessoa respons[áa]vel/.test(src)) offenders.push(`${rel}: declaração pessoal automatizada`);
      if (/\.replace\(\s*\/\\\[REVISAR[^\n]*,\s*[`"']/.test(src)) offenders.push(`${rel}: substituição literal de [REVISAR] (use replaceReviewMarkersForMechanismOnly)`);
    }
    expect(offenders).toEqual([]);
  });
});
