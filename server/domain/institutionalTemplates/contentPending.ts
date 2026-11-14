/**
 * PENDÊNCIA INFORMATIVA DE CONTEÚDO (LICIGOV-FAST PR-2 — "uma informação, um preenchimento"; regra do Owner de 05/11/2026).
 *
 * A ausência de certos dados documentais NÃO bloqueia, por si só, a elaboração, a composição nem a emissão institucional do documento:
 * o sistema indica a pendência, diz quem costuma fornecê-la e reaproveita o dado assim que ele for registrado. Isso é COMPLETUDE
 * documental, não autorização para praticar ato jurídico: a formalização da contratação continua exigindo a indicação dos créditos
 * orçamentários (Lei 14.133/2021, art. 150) — controle do ato de contratar, fora deste módulo.
 *
 * Política EM CÓDIGO (como `lifecycleLateBound`), aplicada a qualquer versão de catálogo que declare a variável com a fonte esperada: o
 * catálogo publicado NÃO muda (nem o hash semântico da revisão). Ausente ⇒ a composição segue e o texto traz o marcador governado
 * `absentText` (inequívoco, em maiúsculas, nunca parece valor real e nunca é `[REVISAR]`). Presente ⇒ o valor declarado é usado
 * normalmente. Nada é inventado nem presumido.
 *
 * O formato do manifesto (M1/M2) NÃO muda (gate R1 do PR #342): a pendência não é campo persistido — leitores de versões anteriores
 * continuam lendo e validando os manifests. O registro auditável é o texto com o marcador, selado pelos hashes da composição e da emissão.
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
  /**
   * Momento em que o dado passa a ser indispensável (orientação; NÃO é gate do sistema): `CONTRACTING` = formalização de cada contratação
   * (ex.: créditos orçamentários, Lei 14.133/2021, art. 150); `PUBLICATION` = antes da publicação do edital (conteúdo do edital — ex.: regras de
   * convocação, art. 25; registro de preços, arts. 82 a 86). A emissão institucional interna ≠ publicação: o documento emitido carrega o marcador.
   */
  readonly neededBefore: "CONTRACTING" | "PUBLICATION";
}

/**
 * Variáveis do Edital institucional cuja ausência é pendência INFORMATIVA (não bloqueante). Chave = nome no catálogo. Variável de DECISÃO não
 * renderizável (enum que escolhe um ramo excludente — ex.: adesão admitida/vedada) ausente ⇒ o compositor NÃO escolhe ramo: insere o marcador.
 */
export const CONTENT_PENDING_VARIABLES: Readonly<Record<string, ContentPendingSpec>> = Object.freeze({
  "julgamento.dotacaoOrcamentaria": Object.freeze({
    source: "PROCESS", label: "Dotação orçamentária",
    absentText: "A INDICAR PELO SETOR RESPONSÁVEL PELA EXECUÇÃO ORÇAMENTÁRIA",
    providedBy: "Setor de contabilidade/orçamento do órgão", neededBefore: "CONTRACTING",
  }),
  "julgamento.fonteRecursos": Object.freeze({
    source: "PROCESS", label: "Fonte de recursos",
    absentText: "A INDICAR COM A DOTAÇÃO ORÇAMENTÁRIA",
    providedBy: "Setor de contabilidade/orçamento do órgão", neededBefore: "CONTRACTING",
  }),
  // LICIGOV-FAST (H5) — políticas do ÓRGÃO exigidas só em registro de preços (`requiredWhen controle.utilizaSrp`). Ausentes, a minuta é composta
  // com o marcador; NADA é presumido: nem adesão admitida ou vedada (o "padrão: veda" da descrição do catálogo NÃO é decisão do órgão), nem
  // marco/prazo, nem o regulamento federal. O valor vem só do Perfil de Licitações (decisão da autoridade do órgão).
  "decisao.adesaoAta": Object.freeze({
    source: "POLICY", label: "Adesão à Ata de Registro de Preços",
    absentText: "ADMISSÃO OU VEDAÇÃO DA ADESÃO À ATA POR ÓRGÃOS E ENTIDADES NÃO PARTICIPANTES A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO",
    providedBy: "Autoridade competente do órgão (Perfil de Licitações)", neededBefore: "PUBLICATION",
  }),
  "srp.marcoInicialVigenciaAta": Object.freeze({
    source: "POLICY", label: "Marco inicial da vigência da Ata",
    absentText: "MARCO INICIAL A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO",
    providedBy: "Autoridade competente do órgão (Perfil de Licitações), conforme o regulamento de registro de preços aplicável", neededBefore: "PUBLICATION",
  }),
  "srp.prazoAssinaturaAta": Object.freeze({
    source: "POLICY", label: "Prazo para assinatura da Ata",
    absentText: "PRAZO A DEFINIR PELO ÓRGÃO ANTES DA PUBLICAÇÃO",
    providedBy: "Autoridade competente do órgão (Perfil de Licitações)", neededBefore: "PUBLICATION",
  }),
});

/** Só vale para a variável DECLARADA com a fonte esperada (outro modelo com o mesmo nome e outra fonte segue a regra comum). */
export const isContentPendingVariable = (def: Pick<VariableDef2, "name" | "source">): boolean =>
  CONTENT_PENDING_VARIABLES[def.name]?.source === def.source;

/** Textos governados do marcador (referência única para testes e futuras guardas). */
export const CONTENT_PENDING_TEXTS: readonly string[] = Object.freeze(Object.values(CONTENT_PENDING_VARIABLES).map((s) => s.absentText));
