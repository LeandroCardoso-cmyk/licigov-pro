/**
 * LICIGOV-FAST (H5) — Edital SRP: as 3 políticas do órgão exigidas só em registro de preços (`decisao.adesaoAta`, `srp.marcoInicialVigenciaAta`,
 * `srp.prazoAssinaturaAta`) passam a ser PENDÊNCIA INFORMATIVA de conteúdo (`contentPending.ts`): ausentes, a minuta é COMPOSTA com o marcador
 * governado (antes: MISSING_REQUIRED + CHOICE_NOT_EXACTLY_ONE); presentes, o valor do órgão é usado. Nada é presumido (nem "veda" — o "padrão"
 * citado na descrição do catálogo —, nem marco/prazo, nem regulamento federal). Formato do M1 inalterado (R1); determinismo/replay.
 * Puro (sem banco). A jornada com MySQL (preparação, preflight, Perfil, recomposição, emissão) está em `fast-pr2-budget-allocation-mysql-smoke`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import type { TemplateAST2 } from "../../domain/institutionalTemplates";
import { BLL_MODEL_DIR, FULL_SCENARIO, bllCatalog, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { CONTENT_PENDING_TEXTS, CONTENT_PENDING_VARIABLES, isContentPendingVariable } from "../../domain/institutionalTemplates/contentPending";
import { computeManifestHash, validateManifest } from "../../domain/institutionalTemplates/manifest";
import { countReviewMarkers, emissionBlockers } from "../../domain/emissionPreconditions";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8")) as TemplateAST2;
const AI_SLOTS = ["justificativa-art49-lc123", "justificativa-vedacao-consorcio", "justificativa-vedacao-subcontratacao", "obrigacoes-especificas-contratado", "obrigacoes-especificas-contratante", "finalidades-tratamento-dados"];
const NARR = AI_SLOTS.map((slotKey) => ({ organizationId: 975001, slotKey, executionId: `aiexec_${slotKey}`, text: `Texto proposto para ${slotKey}, sujeito a revisão humana.` }));
const ADESAO = "decisao.adesaoAta", MARCO = "srp.marcoInicialVigenciaAta", PRAZO = "srp.prazoAssinaturaAta";
const SRP_POLICIES = [ADESAO, MARCO, PRAZO];
const T = (n: string) => CONTENT_PENDING_VARIABLES[n]!.absentText;
const compose = (scenario: Record<string, unknown>, omit: readonly string[] = []) => composeTemplate(bllComposeRequest(ast, scenario, { aiNarratives: NARR }, omit));
const textOf = (r: ReturnType<typeof compose>) => { if (!r.ok) throw new Error(JSON.stringify(r.issues).slice(0, 600)); return r.value.content.text; };
const ADMITE = /Será admitida a adesão à Ata|Esta Ata poderá ser utilizada por órgãos e entidades não participantes/;
const VEDA = /Não será admitida a adesão à Ata|Não é admitida a adesão a esta Ata/;
const BODY_KEYS_9226E4B = new Set(["sources", "conditionalDecisions", "aiNarratives", "annexes", "lateBound", "deferredPublication", "humanEditRefs", "canonicalRevalidation", "lifecycleBindings"]);

describe("política: as 3 variáveis SRP do órgão são pendência informativa (só com a fonte POLICY declarada)", () => {
  it("catálogo publicado inalterado: continuam POLICY, requiredWhen SRP = sim; a política vale só para a fonte declarada", () => {
    for (const n of SRP_POLICIES) {
      const def = bllCatalog.vars.find((v) => v.name === n)!;
      expect(def.source).toBe("POLICY");
      expect(def.requiredWhen).toEqual({ op: "eq", var: "controle.utilizaSrp", value: true });
      expect(isContentPendingVariable(def), n).toBe(true);
      expect(isContentPendingVariable({ ...def, source: "PROCESS" }), `${n} com outra fonte`).toBe(false);
      expect(CONTENT_PENDING_VARIABLES[n]!.neededBefore).toBe("PUBLICATION");
    }
    // P3 (auditoria): o texto do marcador entra no hash de saída composta (replay): mudar a redação exige recomposição ⇒ fixado por igualdade.
    expect(SRP_POLICIES.map(T)).toEqual([
      "ADMISSÃO OU VEDAÇÃO DA ADESÃO À ATA POR ÓRGÃOS E ENTIDADES NÃO PARTICIPANTES A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO",
      "MARCO INICIAL A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO",
      "PRAZO A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO",
    ]);
    for (const t of SRP_POLICIES.map(T)) {
      expect(t).toMatch(/A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO$/);   // inequívoco, nunca parece valor real
      expect(countReviewMarkers(t)).toBe(0);                             // nunca [REVISAR]
      expect(t).not.toMatch(/Decreto|11\.462|(^|\s)(veda|admite)(\s|$)/i);   // não presume decisão nem regulamento
    }
  });
});

describe("composição do Edital BLL com registro de preços", () => {
  it("1) SRP + 3 políticas AUSENTES: compõe (antes: MISSING_REQUIRED/CHOICE_NOT_EXACTLY_ONE); marcadores; nenhum ramo de adesão escolhido; sem [REVISAR] por isso", () => {
    const r = compose(FULL_SCENARIO, SRP_POLICIES);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.issues).slice(0, 500)).toBe(true);
    const text = textOf(r);
    expect(text).toContain(`no prazo de ${T(PRAZO)}, contado da convocação`);
    expect(text).toContain(`contada de ${T(MARCO)}`);
    expect(text.split(`Adesão à Ata de Registro de Preços: ${T(ADESAO)}.`).length - 1).toBe(2);   // edital + anexo da Ata
    expect(text).not.toMatch(ADMITE);
    expect(text).not.toMatch(VEDA);                                       // ausência NÃO é decisão negativa
    expect(text).not.toMatch(/\[REVISAR[^\]]*(adesaoAta|marcoInicialVigenciaAta|prazoAssinaturaAta)/);
    expect(countReviewMarkers(text)).toBe(countReviewMarkers(textOf(compose(FULL_SCENARIO))));   // nenhum [REVISAR] a mais
  });

  it("2) SRP + uma política declarada: usa o valor do órgão e sinaliza só as restantes", () => {
    const declared = textOf(compose(FULL_SCENARIO));
    const prazo = /no prazo de ([^,]+), contado da convocação/.exec(declared)![1];
    const text = textOf(compose(FULL_SCENARIO, [ADESAO, MARCO]));
    expect(text).toContain(`no prazo de ${prazo}, contado da convocação`);
    expect(text).not.toContain(T(PRAZO));
    expect(text).toContain(T(MARCO));
    expect(text).toContain(T(ADESAO));
  });

  it("3) SRP + 3 políticas declaradas: texto do órgão, sem marcador algum; o ramo escolhido é o DECIDIDO", () => {
    const veda = textOf(compose(FULL_SCENARIO));
    for (const t of SRP_POLICIES.map(T)) expect(veda).not.toContain(t);
    expect(veda).toMatch(VEDA);
    const admite = textOf(compose({ ...FULL_SCENARIO, [ADESAO]: "admite" }));
    expect(admite).toMatch(ADMITE);
    expect(admite).not.toMatch(VEDA);
  });

  it("4) SRP = não: nenhuma pendência SRP no texto (as 3 políticas nem são lidas)", () => {
    const text = textOf(compose({ ...FULL_SCENARIO, "controle.utilizaSrp": false }, SRP_POLICIES));
    for (const t of SRP_POLICIES.map(T)) expect(text).not.toContain(t);
  });

  it("5) SRP indefinido: a composição recusa pelo dado do PROCESSO (utilizaSrp é obrigatório) — nada presumido, nem SRP nem dispensa orçamentária", () => {
    const r = compose(FULL_SCENARIO, ["controle.utilizaSrp", ...SRP_POLICIES]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.path)).toContain("vars.controle.utilizaSrp");
  });

  it("fail-closed do grupo excludente: só a decisão PENDENTE da política (ramos sobre ela, condição de exigência ATIVA) recebe o marcador", () => {
    const choice = (branches: Array<{ key: string; when: Record<string, unknown> }>) => ({
      schema: "tpl-ast/2", root: [{ t: "choice", groupKey: "g", mode: "exactly-one", branches: branches.map((b) => ({ ...b, children: [{ t: "paragraph", numbered: true, inline: [{ t: "text", v: `ramo ${b.key}` }] }] })) }],
    }) as unknown as TemplateAST2;
    const run = (a: TemplateAST2, scenario: Record<string, unknown>, omit: readonly string[]) => composeTemplate(bllComposeRequest(a, scenario, {}, omit));   // AST mínimo: sem slots de IA
    const codes = (r: ReturnType<typeof run>) => (r.ok ? [] : r.issues.map((i) => i.code));
    const adesao = choice([{ key: "admite", when: { op: "eq", var: ADESAO, value: "admite" } }, { key: "veda", when: { op: "eq", var: ADESAO, value: "veda" } }]);
    // pendente + SRP = sim ⇒ marcador, nenhum ramo
    const ok = run(adesao, FULL_SCENARIO, [ADESAO]);
    expect(ok.ok, JSON.stringify(ok.ok ? "" : ok.issues)).toBe(true);
    if (ok.ok) { expect(ok.value.content.text).toContain(T(ADESAO)); expect(ok.value.content.text).not.toMatch(/ramo (admite|veda)/); }
    // condição de exigência INATIVA (SRP = não) ⇒ não é pendência da política: continua CHOICE_NOT_EXACTLY_ONE
    expect(codes(run(adesao, { ...FULL_SCENARIO, "controle.utilizaSrp": false }, [ADESAO]))).toContain("CHOICE_NOT_EXACTLY_ONE");
    // grupo MISTO (adesão + outra variável) sem ramo verdadeiro ⇒ continua CHOICE_NOT_EXACTLY_ONE
    const mixed = choice([{ key: "admite", when: { op: "eq", var: ADESAO, value: "admite" } }, { key: "naoSrp", when: { op: "eq", var: "controle.utilizaSrp", value: false } }]);
    expect(codes(run(mixed, FULL_SCENARIO, [ADESAO]))).toContain("CHOICE_NOT_EXACTLY_ONE");
    // variável PRESENTE com valor fora dos ramos não existe no enum (normalização recusa) — e outras obrigatórias continuam MISSING_REQUIRED
    expect(codes(compose(FULL_SCENARIO, ["srp.prazoVigenciaAta"]))).toContain("MISSING_REQUIRED");
  });

  it("C1 (auditoria): o marcador fica NO LUGAR da decisão — item numerado no Edital e a seção 'DA ADESÃO' no anexo da Ata (numeração preservada)", () => {
    const pending = textOf(compose(FULL_SCENARIO, SRP_POLICIES));
    const decided = textOf(compose(FULL_SCENARIO));
    const line = `Adesão à Ata de Registro de Preços: ${T(ADESAO)}.`;
    expect(pending).toMatch(new RegExp(`\\n\\d+\\.\\d+\\. ${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));       // item numerado no corpo
    expect(pending).toMatch(/#+ \d+\. DA ADESÃO\n\n\d+\.1\. Adesão à Ata de Registro de Preços: /);                         // seção própria no anexo
    const sections = (t: string) => (t.match(/#+ \d+\. [A-ZÇÃÕÉÍÓÚÂÊ ]+/g) ?? []);
    expect(sections(pending)).toEqual(sections(decided));                                                                 // nenhuma seção some/renumera
  });

  it("8) M1 no formato ANTERIOR (R1: nenhuma chave nova; leitor da staging 9226e4b); hash e validação íntegros; decisões dos ramos registradas", () => {
    const r = compose(FULL_SCENARIO, SRP_POLICIES);
    if (!r.ok) throw new Error("composição falhou");
    const m = r.value.manifest as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(m, "contentPending")).toBe(false);
    expect(validateManifest(r.value.manifest).ok).toBe(true);
    expect(computeManifestHash(r.value.manifest)).toBe(r.value.manifest.manifestHash);
    const body = r.value.manifest as unknown as { conditionalDecisions: { nodePath: string; result: boolean }[] };
    const adesao = body.conditionalDecisions.filter((d) => /branches\[[01]\]$/.test(d.nodePath));
    expect(adesao.length).toBeGreaterThan(0);
    const full = textOf(compose(FULL_SCENARIO));
    expect(full).not.toBe(r.value.content.text);
    for (const k of Object.keys(m)) if (["sources", "conditionalDecisions"].includes(k)) expect(BODY_KEYS_9226E4B.has(k)).toBe(true);
  });

  it("9) replay determinístico: mesma entrada ⇒ mesmo texto, mesmo hash e mesmo M1", () => {
    const a = compose(FULL_SCENARIO, SRP_POLICIES);
    const b = compose(FULL_SCENARIO, SRP_POLICIES);
    if (!a.ok || !b.ok) throw new Error("composição falhou");
    expect(b.value.content.text).toBe(a.value.content.text);
    expect(b.value.composedOutputHash).toBe(a.value.composedOutputHash);
    expect(b.value.manifest.manifestHash).toBe(a.value.manifest.manifestHash);
  });

  it("7) emissão: o marcador governado não é [REVISAR] (não bloqueia por si só); [REVISAR] e as demais guardas continuam", () => {
    const text = textOf(compose(FULL_SCENARIO, SRP_POLICIES));
    const base = { kind: "edital" as const, contentHash: "h", sourceState: "current" as const, changedSourceLabels: [], trEmitted: true, lastEmittedContentHash: null, lastEmittedVersion: null };
    const markerOnly = SRP_POLICIES.map(T).join("\n");
    expect(emissionBlockers({ ...base, content: markerOnly }).map((b) => b.code)).toEqual([]);
    expect(emissionBlockers({ ...base, content: `${markerOnly}\n[REVISAR: x]` }).map((b) => b.code)).toContain("EMISSION_REVIEW_MARKERS");
    expect(emissionBlockers({ ...base, content: markerOnly, trEmitted: false }).map((b) => b.code)).toContain("EMISSION_TR_NOT_EMITTED");
    expect(CONTENT_PENDING_TEXTS).toEqual(expect.arrayContaining(SRP_POLICIES.map(T)));
    expect(countReviewMarkers(text)).toBe(countReviewMarkers(textOf(compose(FULL_SCENARIO))));
  });
});

describe("P2 — prontidão contextual do Perfil: confirmada só com o TR exato validado (mesma leitura do preflight)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prep = (trPin: any, over: Record<string, unknown> = {}): any => ({
    status: "READY_FOR_PREPARATION", trPin,
    upstream: {
      trDigest: "x", trPending: [], sourcePending: [],
      profilePending: [{ name: "habilitacao.registroCadastralAceito", description: "d", reason: "r" }],
      contentPending: [
        { name: ADESAO, description: "d", reason: "r", fix: "ORG_PROFILE", providedBy: "p" },
        { name: "julgamento.dotacaoOrcamentaria", description: "d", reason: "r", fix: "PROCESS_BUDGET", providedBy: "p" },
      ],
    },
    ...over,
  });

  it("pin VALID ⇒ CONFIRMED; políticas exigidas = perfil incompleto + pendências informativas do ÓRGÃO (orçamento do processo fica fora)", async () => {
    const { profileContextFrom } = await import("../../routers/procurementProcessRouter");
    const c = profileContextFrom(prep({ state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }));
    expect(c.status).toBe("CONFIRMED");
    expect(c.reason).toBeUndefined();
    expect([...c.requiredNow].sort()).toEqual([ADESAO, "habilitacao.registroCadastralAceito"].sort());
  });

  it("sem pin, pin inválido, preparação indisponível ou falha de leitura ⇒ UNVERIFIED com o motivo (nunca 'confirmada')", async () => {
    const { profileContextFrom } = await import("../../routers/procurementProcessRouter");
    expect(profileContextFrom(prep({ state: "NOT_SELECTED" }))).toMatchObject({ status: "UNVERIFIED", reason: "TR oficial exato não informado" });
    expect(profileContextFrom(prep({ state: "INVALID", code: "OFFICIAL_DOCUMENT_HASH_MISMATCH" }))).toMatchObject({ status: "UNVERIFIED", reason: "TR oficial selecionado inválido ou desatualizado (OFFICIAL_DOCUMENT_HASH_MISMATCH)" });
    const unavailable = profileContextFrom({ status: "UNAVAILABLE", resolution: "NOT_BOUND", reason: "sem modelo vinculado" } as never);
    expect(unavailable).toMatchObject({ status: "UNVERIFIED", reason: "preparação do Edital indisponível: sem modelo vinculado" });
    expect(unavailable.requiredNow.size).toBe(0);
    expect(profileContextFrom(null)).toMatchObject({ status: "UNVERIFIED", reason: "leitura contextual indisponível no momento" });
  });

  it("resumo do Perfil: prontidão do processo não verificada NUNCA vira 'completo'; geral e confirmada seguem a regra anterior", async () => {
    const { profileCompletenessSummary } = await import("../../../client/src/lib/contextReuse");
    const base = { revision: 3, conditional: [], summary: { policyTotal: 1, policyFilled: 1, policyPending: 0, rolesNeeded: 0, rolesOk: 0, rolesPending: 0, platformsPending: 0, pendingCount: 0 } };
    expect(profileCompletenessSummary({ ...base, contextStatus: "UNVERIFIED", contextReason: "TR oficial exato não informado" }))
      .toEqual({ tone: "partial", text: "Sem pendências conhecidas. Prontidão para este processo não verificada: TR oficial exato não informado." });
    expect(profileCompletenessSummary({ ...base, summary: { ...base.summary, pendingCount: 2 }, contextStatus: "UNVERIFIED", contextReason: "x" }).text)
      .toBe("2 campos pendentes. Prontidão para este processo não verificada: x.");
    expect(profileCompletenessSummary({ ...base, contextStatus: "CONFIRMED" })).toEqual({ tone: "complete", text: "Perfil completo (revisão 3)" });
    expect(profileCompletenessSummary({ ...base, contextStatus: "GENERAL" }).tone).toBe("complete");
  });
});
