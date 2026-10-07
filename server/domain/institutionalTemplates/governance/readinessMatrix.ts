/**
 * MATRIZ DE PRONTIDÃO antes da publicação (piloto Edital) — domínio puro e determinístico (mesma entrada ⇒ mesma matriz).
 *
 * Cada verificação termina em PASS, BLOCKED ou NOT_APPLICABLE — nunca "ignorada". Nada é escondido: o que não pode ser provado
 * (inventário ausente, capacidade inexistente, evidência ausente) é BLOCKED com o motivo. Governança: PASS e NOT_APPLICABLE são admissíveis;
 * QUALQUER BLOCKED ⇒ PUBLICATION_BLOCKED (o workflow recalcula a matriz no servidor antes de APPROVED → PUBLISHED). A matriz não
 * aprova, não publica e não muda status; uma decisão humana não substitui pré-condição estrutural/técnica ausente.
 */
import type { TemplateRevision } from "../revision";
import { templateHash } from "../semanticHash";
import { findAnyVariable, type AnyVariableCatalog } from "../astVersions";
import { analyzeAst } from "./astFacts";
import { ANY_SECTION } from "./sourceInventory";
import { buildReadinessWitness, type ReadinessWitness } from "./readinessWitness";
import type { TemplateCapabilities } from "./capabilities";
import { evidenceCoversSource, type LegalApprovalEvidence } from "./legalEvidence";
import type { ImportProvenance } from "./importProvenance";
import { inventoryCounts, inventoryHash, type SourceInventory } from "./sourceInventory";

export type ReadinessStatus = "PASS" | "BLOCKED" | "NOT_APPLICABLE";

export const READINESS_CHECK_IDS = [
  "SOURCE_PROVENANCE", "INPUTS_ACCOUNTED", "CONTROL_ONLY_INPUTS", "CONDITION_TYPES", "ITEMS_BACKING", "TR_EXACT_PIN",
  "CERTAME_CONFIG", "SOURCE_BACKING", "ANNEX_MAPPING", "XREF_INTEGRITY", "AI_SLOTS", "LEGAL_APPROVAL_EVIDENCE",
] as const;
export type ReadinessCheckId = (typeof READINESS_CHECK_IDS)[number];

export const READINESS_CHECK_LABEL: Readonly<Record<ReadinessCheckId, string>> = Object.freeze({
  SOURCE_PROVENANCE: "Procedência da fonte (versão lógica + SHA-256)",
  INPUTS_ACCOUNTED: "Entradas da fonte contabilizadas",
  CONTROL_ONLY_INPUTS: "Entradas control-only",
  CONDITION_TYPES: "Tipos de condição",
  ITEMS_BACKING: "Backing de ITEMS",
  TR_EXACT_PIN: "Capacidade de pin exato do TR",
  CERTAME_CONFIG: "Capacidade CERTAME_CONFIG",
  SOURCE_BACKING: "Backing das fontes canônicas usadas (POLICY, BUDGET, NORMATIVE, LIFECYCLE, RESULT…)",
  ANNEX_MAPPING: "Mapeamento de anexos",
  XREF_INTEGRITY: "Integridade das referências cruzadas",
  AI_SLOTS: "Slots de IA",
  LEGAL_APPROVAL_EVIDENCE: "Evidência de aprovação jurídica externa",
});

export interface ReadinessCheck {
  readonly id: ReadinessCheckId;
  readonly label: string;
  readonly status: ReadinessStatus;
  readonly detail: string;
  /** Achados específicos (limitados a 25 para a UI; a contagem total está em `findingsTotal`). */
  readonly findings: readonly string[];
  readonly findingsTotal: number;
}

export interface ReadinessMatrix {
  readonly revisionId: string;
  readonly revisionSemanticHash: string;
  readonly checks: readonly ReadinessCheck[];
  readonly summary: { readonly pass: number; readonly blocked: number; readonly notApplicable: number };
  /** `READY` só quando NENHUMA verificação está BLOCKED. `READY` não publica nada: a publicação é decisão humana. */
  readonly overall: "READY" | "BLOCKED";
  /** Hash determinístico da matriz (sem relógio) — a decisão humana de publicar pode citá-lo. */
  readonly matrixHash: string;
  /** Estado autoritativo em que a matriz foi provada (revalidado dentro da transação de publicação). */
  readonly witness: ReadinessWitness;
  readonly notices: readonly string[];
}

export interface ReadinessInput {
  readonly revision: Pick<TemplateRevision, "id" | "semanticHash" | "ast" | "variableCatalogVersion" | "status">;
  readonly catalog: AnyVariableCatalog | null;
  readonly provenance: ImportProvenance | null;
  readonly legalEvidence: LegalApprovalEvidence | null;
  /** Inventário reenviado pelo operador (validado em forma por `parseSourceInventory`); `null` = não fornecido. */
  readonly inventory: SourceInventory | null;
  readonly capabilities: TemplateCapabilities;
}

const LIMIT = 25;
const mk = (id: ReadinessCheckId, status: ReadinessStatus, detail: string, findings: readonly string[] = []): ReadinessCheck =>
  ({ id, label: READINESS_CHECK_LABEL[id], status, detail, findings: findings.slice(0, LIMIT), findingsTotal: findings.length });
const blocked = (id: ReadinessCheckId, detail: string, findings: readonly string[] = []) => mk(id, "BLOCKED", detail, findings);
const NO_INVENTORY = "inventário da fonte não fornecido — não é possível provar este item (reenvie o pacote de proveniência)";

export function evaluateReadiness(input: ReadinessInput): ReadinessMatrix {
  const { revision, catalog, provenance, legalEvidence: ev, inventory: inv, capabilities } = input;
  const facts = analyzeAst(revision.ast, catalog);
  const checks: ReadinessCheck[] = [];

  // 1 ─ procedência
  if (!provenance) checks.push(blocked("SOURCE_PROVENANCE", "nenhuma procedência registrada para esta revisão (registre/importe o modelo pelo fluxo de registro)"));
  else if (provenance.revisionSemanticHash !== revision.semanticHash) {
    checks.push(blocked("SOURCE_PROVENANCE", "o conteúdo da revisão difere do conteúdo importado (editado após a importação); registre nova procedência assumindo a divergência ou crie nova revisão",
      [`hash na importação: ${provenance.revisionSemanticHash.slice(0, 12)}…`, `hash atual: ${revision.semanticHash.slice(0, 12)}…`]));
  } else {
    checks.push(mk("SOURCE_PROVENANCE", "PASS", `fonte ${provenance.sourceLogicalVersion} · sha256 ${provenance.sourceSha256.slice(0, 12)}… · registrada por usuário ${provenance.recordedByUserId}`));
  }

  // inventário confrontado com a procedência (hash + contagens declaradas na importação)
  let invUsable: SourceInventory | null = null;
  let invProblem: string | null = null;
  if (!inv) invProblem = NO_INVENTORY;
  else if (!provenance) invProblem = "sem procedência registrada para confrontar o inventário";
  else if (!provenance.inventory) invProblem = "a procedência não registrou o hash do inventário; registre nova procedência com o inventário";
  else if (inventoryHash(inv) !== provenance.inventory.sha256) invProblem = "o inventário reenviado difere do registrado na procedência (SHA-256 diferente)";
  else if (inv.sourceSha256 !== provenance.sourceSha256 || inv.sourceLogicalVersion !== provenance.sourceLogicalVersion) invProblem = "o inventário não corresponde à versão/SHA-256 da fonte registrada";
  else invUsable = inv;

  // 2 ─ entradas
  if (!invUsable) checks.push(blocked("INPUTS_ACCOUNTED", invProblem!));
  else {
    const f: string[] = [];
    const counts = inventoryCounts(invUsable);
    if (counts.inputsTotal !== invUsable.declared.inputsTotal) f.push(`declaradas ${invUsable.declared.inputsTotal}, listadas ${counts.inputsTotal}`);
    if (provenance!.inventory!.inputsTotal !== counts.inputsTotal) f.push(`a procedência registrou ${provenance!.inventory!.inputsTotal} entradas`);
    const keys = new Set<string>();
    for (const i of invUsable.inputs) {
      if (keys.has(i.key)) f.push(`entrada duplicada: ${i.key}`);
      keys.add(i.key);
      if (i.disposition === "AI_SLOT") {
        if (!facts.aiSlots.some((x) => x.slotKey === i.variable)) f.push(`entrada ${i.key} → slot de IA inexistente no AST: ${i.variable}`);
      } else if (i.disposition === "DOC_REF") {
        if (facts.docRefs.length === 0) f.push(`entrada ${i.key} → o AST não referencia documento oficial (${i.variable})`);
      } else if (!catalog) f.push(`catálogo ${revision.variableCatalogVersion} indisponível`);
      else if (!findAnyVariable(catalog, i.variable)) f.push(`entrada ${i.key} → variável fora do catálogo ${catalog.version}: ${i.variable}`);
    }
    checks.push(f.length ? blocked("INPUTS_ACCOUNTED", `${f.length} pendência(s) na contabilização das entradas`, f)
      : mk("INPUTS_ACCOUNTED", "PASS", `${counts.inputsTotal} entradas contabilizadas, todas mapeadas no catálogo ${catalog!.version}`));
  }

  // 3 ─ control-only
  if (!invUsable) checks.push(blocked("CONTROL_ONLY_INPUTS", invProblem!));
  else {
    const controlOnly = invUsable.inputs.filter((i) => i.disposition === "CONTROL_ONLY");
    const f: string[] = [];
    if (controlOnly.length !== invUsable.declared.controlOnlyInputs) f.push(`declaradas ${invUsable.declared.controlOnlyInputs}, listadas ${controlOnly.length}`);
    if (provenance!.inventory!.controlOnlyInputs !== controlOnly.length) f.push(`a procedência registrou ${provenance!.inventory!.controlOnlyInputs}`);
    for (const i of controlOnly) {
      if (facts.textVariables.includes(i.variable)) f.push(`${i.key}: control-only aparece no TEXTO do modelo (${i.variable})`);
      if (!facts.conditionVariables.includes(i.variable) && !facts.controlRefVariables.includes(i.variable)) f.push(`${i.key}: control-only não controla nenhuma condição nem validação (${i.variable})`);
    }
    checks.push(f.length ? blocked("CONTROL_ONLY_INPUTS", `${f.length} pendência(s)`, f)
      : mk("CONTROL_ONLY_INPUTS", "PASS", `${controlOnly.length} entradas control-only: só controlam condições, nunca aparecem no texto`));
  }

  // 4 ─ tipos de condição
  if (!invUsable) checks.push(blocked("CONDITION_TYPES", invProblem!));
  else {
    const f: string[] = [];
    const counts = inventoryCounts(invUsable);
    if (counts.conditionTypes !== invUsable.declared.conditionTypes) f.push(`declarados ${invUsable.declared.conditionTypes}, listados ${counts.conditionTypes}`);
    if (provenance!.inventory!.conditionTypes !== counts.conditionTypes) f.push(`a procedência registrou ${provenance!.inventory!.conditionTypes}`);
    const declared = new Set(invUsable.conditionTypes.map((c) => c.variable));
    for (const c of invUsable.conditionTypes) if (!facts.conditionVariables.includes(c.variable)) f.push(`tipo ${c.key}: nenhuma condição do AST usa ${c.variable}`);
    const guards = new Set((invUsable.guards ?? []).map((g) => g.variable));
    for (const v of facts.conditionVariables) if (!declared.has(v) && !guards.has(v)) f.push(`condição do AST sobre ${v} sem tipo declarado no inventário`);
    checks.push(f.length ? blocked("CONDITION_TYPES", `${f.length} pendência(s)`, f)
      : mk("CONDITION_TYPES", "PASS", `${counts.conditionTypes} tipos de condição declarados e presentes no AST (${facts.conditionalCount} nós condicionais)`));
  }

  // 5 ─ ITEMS
  const itemsInAst = [...new Set([...facts.textVariables, ...facts.conditionVariables])].filter((n) => (catalog ? findAnyVariable(catalog, n)?.source === "ITEMS" : false));
  const itemsInInventory = invUsable ? invUsable.inputs.filter((i) => i.source === "ITEMS" || i.disposition === "ITEMS_TABLE").map((i) => i.key) : [];
  if (itemsInAst.length === 0 && facts.dynamicTables.length === 0 && itemsInInventory.length === 0) {
    checks.push(mk("ITEMS_BACKING", "NOT_APPLICABLE", invUsable ? "o modelo não usa ITEMS nem tabelas dinâmicas" : "o AST não usa ITEMS nem tabelas dinâmicas (inventário não fornecido: entradas ITEMS do inventário não puderam ser verificadas)"));
  } else if (capabilities.sources.ITEMS) {
    checks.push(mk("ITEMS_BACKING", "PASS", `ITEMS com backing canônico; ${itemsInAst.length} variável(is), ${facts.dynamicTables.length} tabela(s) dinâmica(s)`));
  } else {
    checks.push(blocked("ITEMS_BACKING", "o modelo depende de ITEMS, mas a fonte ITEMS não tem backing no sistema (geração falharia fechada)",
      [...itemsInAst.map((n) => `variável ITEMS: ${n}`), ...facts.dynamicTables.map((t) => `tabela dinâmica em ${t.path}: ${t.dynamicVariables.join(", ")}`), ...itemsInInventory.map((k) => `entrada ITEMS no inventário: ${k}`)]));
  }

  // 6 ─ TR pin
  const trRefs = facts.docRefs.filter((r) => r.kind === "TR");
  if (trRefs.length === 0) checks.push(mk("TR_EXACT_PIN", "NOT_APPLICABLE", "o modelo não referencia o TR oficial"));
  else if (capabilities.trExactPin) checks.push(mk("TR_EXACT_PIN", "PASS", `${trRefs.length} referência(s) ao TR por pin EXATO (documento + linhagem + versão + hash)`));
  else checks.push(blocked("TR_EXACT_PIN", "o sistema não consegue resolver o TR por pin exato"));

  // 7 ─ CERTAME_CONFIG
  if (!invUsable) checks.push(blocked("CERTAME_CONFIG", invProblem!));
  else {
    const needs = invUsable.inputs.filter((i) => i.source === "CERTAME_CONFIG");
    if (needs.length === 0) checks.push(mk("CERTAME_CONFIG", "NOT_APPLICABLE", "nenhuma entrada depende de CERTAME_CONFIG"));
    else if (capabilities.sources.CERTAME_CONFIG) checks.push(mk("CERTAME_CONFIG", "PASS", `${needs.length} entrada(s) CERTAME_CONFIG com backing`));
    else checks.push(blocked("CERTAME_CONFIG", `${needs.length} entrada(s) dependem de CERTAME_CONFIG, mas a fonte não existe no sistema`, needs.map((i) => i.key)));
  }

  // 7b ─ demais fontes canônicas usadas pelo catálogo (cada variável resolve pela fonte DEFINIDA no catálogo)
  {
    const used = new Map<string, string[]>();
    if (catalog) {
      for (const n of new Set([...facts.textVariables, ...facts.conditionVariables, ...facts.columnConditionVariables])) {
        const def = findAnyVariable(catalog, n);
        if (def) used.set(def.source, [...(used.get(def.source) ?? []), n]);
      }
    }
    const missing: string[] = [];
    for (const [source, names] of used) {
      if (source === "ITEMS" || source === "CERTAME_CONFIG") continue; // verificadas acima
      const cap = (capabilities.sources as Readonly<Record<string, boolean | "OPTIONAL_ONLY">>)[source];
      // OPTIONAL_ONLY (ex.: RESULT no pré-certame): só admissível se TODA variável usada for opcional (texto governado "a preencher").
      const requiredUse = cap === "OPTIONAL_ONLY" ? names.filter((n) => { const d = findAnyVariable(catalog!, n) as { required?: boolean; requiredWhen?: unknown } | undefined; return !d || d.required === true || d.requiredWhen !== undefined; }) : [];
      const backed = cap === "OPTIONAL_ONLY" ? requiredUse.length === 0 : cap === true;
      if (!backed) missing.push(`${source}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` (+${names.length - 3})` : ""}`);
    }
    const others = [...used.keys()].filter((x) => x !== "ITEMS" && x !== "CERTAME_CONFIG");
    if (!catalog) checks.push(blocked("SOURCE_BACKING", `catálogo ${revision.variableCatalogVersion} indisponível`));
    else if (others.length === 0) checks.push(mk("SOURCE_BACKING", "NOT_APPLICABLE", "o modelo não usa outras fontes além de ITEMS e CERTAME_CONFIG"));
    else if (missing.length) checks.push(blocked("SOURCE_BACKING", `${missing.length} fonte(s) sem backing no sistema (a geração falharia fechada)`, missing));
    else checks.push(mk("SOURCE_BACKING", "PASS", `fontes com backing canônico: ${others.sort().join(", ")}`));
  }

  // 8 ─ anexos
  if (!invUsable) {
    checks.push(facts.annexIds.length === 0 ? mk("ANNEX_MAPPING", "NOT_APPLICABLE", "o AST não tem anexos (inventário não fornecido: anexos do inventário não puderam ser verificados)") : blocked("ANNEX_MAPPING", invProblem!));
  } else if (invUsable.annexes.length === 0 && facts.annexIds.length === 0) {
    checks.push(mk("ANNEX_MAPPING", "NOT_APPLICABLE", "sem anexos no inventário nem no AST"));
  } else {
    const f: string[] = [];
    const mapped = new Set<string>();
    for (const a of invUsable.annexes) {
      if (mapped.has(a.annexId)) f.push(`anexo do AST mapeado mais de uma vez: ${a.annexId}`);
      mapped.add(a.annexId);
      if (!facts.annexIds.includes(a.annexId)) f.push(`anexo ${a.sourceId} → ${a.annexId}: não existe no AST`);
    }
    for (const id of facts.annexIds) if (!mapped.has(id)) f.push(`anexo do AST sem mapeamento para a fonte: ${id}`);
    checks.push(f.length ? blocked("ANNEX_MAPPING", `${f.length} pendência(s)`, f) : mk("ANNEX_MAPPING", "PASS", `${facts.annexIds.length} anexo(s) mapeado(s) um-a-um`));
  }

  // 9 ─ referências cruzadas
  {
    const f: string[] = [];
    for (const k of facts.duplicateSectionKeys) f.push(`chave de seção duplicada: ${k}`);
    if (invUsable) {
      for (const x of invUsable.crossReferences) {
        const ok = x.to.kind === "SECTION" ? facts.sectionKeys.includes(x.to.id) || facts.anchors.includes(x.to.id) : facts.annexIds.includes(x.to.id);
        if (x.fromSection !== ANY_SECTION && !facts.sectionKeys.includes(x.fromSection)) f.push(`referência a partir de seção inexistente: ${x.fromSection}`);
        if (!ok) f.push(`referência ${x.fromSection} → ${x.to.kind} ${x.to.id}: destino inexistente`);
      }
    }
    const nothing = facts.sectionKeys.length === 0 && facts.annexIds.length === 0 && (!invUsable || invUsable.crossReferences.length === 0);
    if (f.length) checks.push(blocked("XREF_INTEGRITY", `${f.length} pendência(s) de integridade`, f));
    else if (nothing) checks.push(mk("XREF_INTEGRITY", "NOT_APPLICABLE", "sem seções, anexos nem referências cruzadas"));
    else if (!invUsable) checks.push(blocked("XREF_INTEGRITY", "chaves de seção/anexo íntegras, mas as referências cruzadas da fonte não puderam ser verificadas: " + NO_INVENTORY));
    else checks.push(mk("XREF_INTEGRITY", "PASS", `${invUsable.crossReferences.length} referência(s) cruzada(s) resolvem para seção/anexo existente`));
  }

  // 10 ─ slots de IA
  {
    const f: string[] = [];
    const slotKeys = facts.aiSlots.map((s) => s.slotKey);
    for (const s of facts.aiSlots) if (s.maxTokens > 8000) f.push(`slot ${s.slotKey}: maxTokens ${s.maxTokens} acima do limite operacional de 8000`);
    if (invUsable?.aiSlots) {
      const declared = new Set(invUsable.aiSlots.map((s) => s.slotKey));
      for (const k of slotKeys) if (!declared.has(k)) f.push(`slot do AST não declarado no inventário: ${k}`);
      for (const k of declared) if (!slotKeys.includes(k)) f.push(`slot declarado no inventário ausente do AST: ${k}`);
    }
    if (slotKeys.length === 0 && f.length === 0) checks.push(mk("AI_SLOTS", "NOT_APPLICABLE", "o modelo não tem slots de IA"));
    else if (f.length) checks.push(blocked("AI_SLOTS", `${f.length} pendência(s)`, f));
    else checks.push(mk("AI_SLOTS", "PASS", `${slotKeys.length} slot(s) de IA delimitados; a IA só atua por solicitação explícita e a saída exige aceite humano exato${capabilities.aiNarrativeProducer ? "" : " (produtor automático de narrativas ainda não existe: as execuções serão informadas por id auditável)"}`));
  }

  // 11 ─ evidência jurídica
  if (!ev) checks.push(blocked("LEGAL_APPROVAL_EVIDENCE", "nenhuma evidência de aprovação jurídica externa registrada (metadado de governança; não é status do ciclo de vida)"));
  else if (!provenance) checks.push(blocked("LEGAL_APPROVAL_EVIDENCE", "há evidência, mas não há procedência da fonte para confrontá-la"));
  else if (!evidenceCoversSource(ev, provenance)) {
    checks.push(blocked("LEGAL_APPROVAL_EVIDENCE", "a evidência registrada não corresponde à versão lógica/SHA-256 da fonte importada",
      [`evidência: ${ev.sourceLogicalVersion} · ${ev.sourceSha256.slice(0, 12)}…`, `fonte: ${provenance.sourceLogicalVersion} · ${provenance.sourceSha256.slice(0, 12)}…`]));
  } else if (ev.revisionSemanticHash !== revision.semanticHash) {
    checks.push(blocked("LEGAL_APPROVAL_EVIDENCE", "o conteúdo da revisão mudou depois do registro da evidência", [`hash na evidência: ${ev.revisionSemanticHash.slice(0, 12)}…`, `hash atual: ${revision.semanticHash.slice(0, 12)}…`]));
  } else {
    checks.push(mk("LEGAL_APPROVAL_EVIDENCE", "PASS", `evidência v${ev.version} cobre ${ev.sourceLogicalVersion} · registrada por usuário ${ev.recordedByUserId}${ev.parecerNumber ? ` · parecer ${ev.parecerNumber}` : " · sem número de parecer informado"}`));
  }

  const summary = {
    pass: checks.filter((c) => c.status === "PASS").length,
    blocked: checks.filter((c) => c.status === "BLOCKED").length,
    notApplicable: checks.filter((c) => c.status === "NOT_APPLICABLE").length,
  };
  const matrixHash = templateHash({ v: "tpl-readiness/1", revision: revision.semanticHash, checks: checks.map((c) => [c.id, c.status, c.findingsTotal]) });
  const notices = [
    "A matriz é recalculada pelo servidor na publicação: qualquer BLOCKED impede a publicação (PUBLICATION_BLOCKED) e nenhuma decisão humana a substitui.",
    "PASS/NOT_APPLICABLE não aprovam nem publicam sozinhos: aprovação e publicação seguem como decisões humanas distintas, registradas no ledger institucional.",
  ];
  const witness = buildReadinessWitness({
    revisionId: revision.id, revisionSemanticHash: revision.semanticHash, catalogVersion: revision.variableCatalogVersion,
    catalogHash: catalog ? templateHash(catalog) : null, capabilitiesHash: templateHash(capabilities),
    inventoryHash: invUsable ? inventoryHash(invUsable) : null,
    provenanceDecisionId: provenance?.decisionId ?? null, legalEvidenceDecisionId: ev?.decisionId ?? null, matrixHash,
  });
  return { revisionId: revision.id, revisionSemanticHash: revision.semanticHash, checks, summary, overall: summary.blocked === 0 ? "READY" : "BLOCKED", matrixHash, witness, notices };
}
