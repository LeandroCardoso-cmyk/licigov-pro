/**
 * PENDÊNCIA INFORMATIVA DE CONTEÚDO (LICIGOV-FAST PR-2 — "uma informação, um preenchimento"; regra do Owner de 05/11/2026).
 *
 * A ausência de certos dados documentais NÃO bloqueia, por si só, a elaboração, a composição nem a emissão institucional do documento:
 * o sistema indica a pendência, diz quem costuma fornecê-la e reaproveita o dado assim que ele for registrado. Isso é COMPLETUDE
 * documental, não autorização para praticar ato jurídico: a formalização da contratação continua exigindo a indicação dos créditos
 * orçamentários (Lei 14.133/2021, art. 150) — controle do ato de contratar, fora deste módulo.
 *
 * Política EM CÓDIGO (como `lifecycleLateBound`), aplicada a qualquer versão de catálogo que declare a variável com a fonte esperada: o
 * catálogo publicado NÃO muda (nem o hash semântico da revisão). Ausente ⇒ a composição segue, o texto traz o marcador governado
 * `absentText` (inequívoco, em maiúsculas, nunca parece valor real e nunca é `[REVISAR]`) e o M1 registra o campo como `PENDING`.
 * Presente ⇒ o valor declarado é usado normalmente. Nada é inventado nem presumido.
 *
 * Puro e determinístico (sem I/O, sem relógio).
 */
import type { VariableDef2 } from "./variableCatalog2";

export interface ContentPendingSpec {
  /** Fonte esperada no catálogo (a política só vale para a variável declarada com esta fonte). */
  readonly source: VariableDef2["source"];
  /** Rótulo operacional (tela, avisos). */
  readonly label: string;
  /** Texto governado no documento enquanto o dado não for registrado. */
  readonly absentText: string;
  /** Quem costuma fornecer o dado (orientação ao servidor; não é atribuição de competência). */
  readonly providedBy: string;
}

/** Variáveis do Edital institucional cuja ausência é pendência INFORMATIVA (não bloqueante). Chave = nome no catálogo. */
export const CONTENT_PENDING_VARIABLES: Readonly<Record<string, ContentPendingSpec>> = Object.freeze({
  "julgamento.dotacaoOrcamentaria": Object.freeze({
    source: "PROCESS", label: "Dotação orçamentária",
    absentText: "A INDICAR PELO SETOR RESPONSÁVEL PELA EXECUÇÃO ORÇAMENTÁRIA",
    providedBy: "Setor de contabilidade/orçamento do órgão",
  }),
  "julgamento.fonteRecursos": Object.freeze({
    source: "PROCESS", label: "Fonte de recursos",
    absentText: "A INDICAR COM A DOTAÇÃO ORÇAMENTÁRIA",
    providedBy: "Setor de contabilidade/orçamento do órgão",
  }),
});

/** Só vale para a variável DECLARADA com a fonte esperada (outro modelo com o mesmo nome e outra fonte segue a regra comum). */
export const isContentPendingVariable = (def: Pick<VariableDef2, "name" | "source">): boolean =>
  CONTENT_PENDING_VARIABLES[def.name]?.source === def.source;

export const CONTENT_PENDING_STATUS = "PENDING" as const;

/** Registro do M1: a variável estava ausente e o documento RENDERIZOU o marcador governado (texto e manifesto coincidem). */
export interface ContentPendingRef {
  readonly variable: string;
  readonly status: typeof CONTENT_PENDING_STATUS;
}

/** Textos governados (para guardas de apresentação/exportação e testes). */
export const CONTENT_PENDING_TEXTS: readonly string[] = Object.freeze(Object.values(CONTENT_PENDING_VARIABLES).map((s) => s.absentText));
