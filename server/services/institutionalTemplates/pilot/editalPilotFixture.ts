/**
 * Fixture SINTÉTICA do piloto Edital (NÃO é o conteúdo jurídico do Modelo-Mestre BLL): 160 entradas (3 control-only), 48 tipos
 * de condição, anexos, referências cruzadas, tabela dinâmica opcional (ITEMS), slot de IA e `docRef` TR exato. Existe só para
 * exercitar o fluxo/matriz/preview/harness sem texto jurídico real. Texto = "Cláusula sintética NN".
 * O conteúdo real chega pelos arquivos `--ast-file`/`--inventory-file` do harness (Lane A/B), nunca daqui.
 */
import { createHash } from "node:crypto";
import type { TemplateAST, TemplateNode, VariableCatalog } from "../../../domain/institutionalTemplates";
import { templateHash } from "../../../domain/institutionalTemplates";
import { BASELINE_CAPABILITIES_D4BB209, type TemplateCapabilities } from "../../../domain/institutionalTemplates/governance/capabilities";
import { SCOPE_DIMENSIONS } from "../../../domain/institutionalTemplates/governance/scopeDimensions";
import type { SourceInventory } from "../../../domain/institutionalTemplates/governance/sourceInventory";

export const PILOT_SYNTHETIC_CATALOG_VERSION = "pilot-synthetic/1";
export const PILOT_SOURCE_LOGICAL_VERSION = "1.0.1-draft";
export const PILOT_INPUTS_TOTAL = 160;
export const PILOT_CONTROL_ONLY = 3;
export const PILOT_CONDITION_TYPES = 48;
const pad = (n: number): string => String(n).padStart(3, "0");
const varName = (n: number): string => `ent.i${pad(n)}`;

export interface PilotFixtureOptions {
  /** Inclui tabela dinâmica com variável ITEMS (sem backing em `main@d4bb209` ⇒ BLOCKED na matriz). */
  readonly withItemsTable?: boolean;
  /** Inclui entrada que depende de CERTAME_CONFIG (sem fonte no sistema ⇒ BLOCKED). */
  readonly withCertameConfig?: boolean;
}

export function buildPilotCatalog(opts: PilotFixtureOptions = {}): VariableCatalog {
  const vars: VariableCatalog["vars"][number][] = [];
  for (let n = 1; n <= PILOT_INPUTS_TOTAL; n++) {
    const items = opts.withItemsTable && n === PILOT_INPUTS_TOTAL;
    vars.push({ name: varName(n), type: items ? "list" : "string", source: items ? "ITEMS" : "PARAMS", path: `i${pad(n)}`, required: false });
  }
  vars.push({ name: "processo.numero", type: "string", source: "PROCESS", path: "number", required: false });
  vars.push({ name: "edital.modalidade", type: "string", source: "PARAMS", path: "modality", required: false });
  vars.push({ name: "edital.forma", type: "string", source: "PARAMS", path: "form", required: false });
  vars.push({ name: "edital.plataforma", type: "string", source: "PARAMS", path: "platform", required: false });
  return { version: PILOT_SYNTHETIC_CATALOG_VERSION, vars };
}

const T = (v: string) => ({ t: "text" as const, v });
const V = (name: string) => ({ t: "var" as const, name });

export function buildPilotAst(opts: PilotFixtureOptions = {}): TemplateAST {
  const root: TemplateNode[] = [{ t: "heading", level: 1, text: [T("Edital sintético nº "), V("processo.numero")] }];
  const lastItems = PILOT_INPUTS_TOTAL;
  // seções com texto sintético; entradas 4..160 aparecem no texto; 1..3 são control-only (só em condições)
  for (let s = 1; s <= 20; s++) {
    const inputs = [] as number[];
    for (let n = PILOT_CONTROL_ONLY + 1 + (s - 1) * 8; n <= Math.min(PILOT_CONTROL_ONLY + s * 8, lastItems - (opts.withItemsTable ? 1 : 0)); n++) inputs.push(n);
    const children: TemplateNode[] = [
      { t: "heading", level: 2, text: [T(`Seção sintética ${pad(s)}`)] },
      { t: "paragraph", inline: [T(`Cláusula sintética ${pad(s)}: `), ...inputs.flatMap((n) => [V(varName(n)), T("; ")])] },
    ];
    root.push({ t: "section", key: `s${pad(s)}`, legalRef: "sintetico", children });
  }
  // 48 tipos de condição: variáveis 1..48 (1..3 control-only)
  for (let c = 1; c <= PILOT_CONDITION_TYPES; c++) {
    root.push({
      t: "conditional", when: { op: "eq", var: varName(c), value: "SIM" },
      then: [{ t: "paragraph", inline: [T(`Bloco condicional sintético ${pad(c)}.`)] }],
      else: [{ t: "paragraph", inline: [T(`Alternativa sintética ${pad(c)}.`)] }],
    });
  }
  root.push({ t: "docRef", kind: "TR", mode: "EXACT_PINNED" });
  if (opts.withItemsTable) {
    root.push({ t: "table", header: [[T("Itens")]], rows: [[[V(varName(PILOT_INPUTS_TOTAL))]]] });
  }
  root.push({ t: "aiSlot", slotKey: "justificativa", maxTokens: 600, instructionsKey: "edital.justificativa" });
  for (const a of ["anexo-i", "anexo-ii", "anexo-iii", "anexo-iv"]) {
    root.push({ t: "annex", id: a, title: [T(`Anexo sintético ${a}`)], children: a === "anexo-i" ? [{ t: "docRef", kind: "TR", mode: "EXACT_PINNED" }] : [{ t: "paragraph", inline: [T(`Conteúdo sintético do ${a}.`)] }] });
  }
  return { schema: "tpl-ast/1", root };
}

/** SHA-256 sintético da "fonte" (do AST canônico) — o real é o SHA-256 do conteúdo congelado informado pelo humano. */
export const pilotSourceSha256 = (ast: TemplateAST): string => createHash("sha256").update(templateHash(ast)).digest("hex");

export function buildPilotInventory(ast: TemplateAST, opts: PilotFixtureOptions = {}): SourceInventory {
  const inputs = Array.from({ length: PILOT_INPUTS_TOTAL }, (_, i) => {
    const n = i + 1;
    const items = opts.withItemsTable && n === PILOT_INPUTS_TOTAL;
    const certame = opts.withCertameConfig && n === PILOT_INPUTS_TOTAL - 1;
    return {
      key: `INPUT_${pad(n)}`, disposition: n <= PILOT_CONTROL_ONLY ? ("CONTROL_ONLY" as const) : items ? ("ITEMS_TABLE" as const) : ("VARIABLE" as const), variable: varName(n),
      ...(items ? { source: "ITEMS" as const } : certame ? { source: "CERTAME_CONFIG" as const } : {}),
    };
  });
  return {
    schema: "tpl-source-inventory/1", sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast),
    declared: { inputsTotal: PILOT_INPUTS_TOTAL, controlOnlyInputs: PILOT_CONTROL_ONLY, conditionTypes: PILOT_CONDITION_TYPES },
    inputs,
    conditionTypes: Array.from({ length: PILOT_CONDITION_TYPES }, (_, i) => ({ key: `COND_${pad(i + 1)}`, variable: varName(i + 1) })),
    annexes: ["anexo-i", "anexo-ii", "anexo-iii", "anexo-iv"].map((a, i) => ({ sourceId: `ANEXO_${i + 1}`, annexId: a })),
    crossReferences: [{ fromSection: "s001", to: { kind: "ANNEX", id: "anexo-i" } }, { fromSection: "s002", to: { kind: "SECTION", id: "s001" } }],
    aiSlots: [{ slotKey: "justificativa" }],
  };
}

/** Capacidades do cenário "pronto" (tudo com backing) — só para provar que a matriz fica READY quando as capacidades existirem. */
export const ALL_CAPABILITIES: TemplateCapabilities = Object.freeze({
  sources: Object.freeze({ PROCESS: true, DFD: true, ETP: true, TR: true, PARAMS: true, IDENTITY: true, ITEMS: true, CERTAME_CONFIG: true }),
  trExactPin: true, aiNarrativeProducer: true, scopeDimensions: SCOPE_DIMENSIONS,
}) as TemplateCapabilities;

export { BASELINE_CAPABILITIES_D4BB209 };
