/**
 * SEM-060 — "Assinar parecer" é IRREVERSÍVEL: depois da assinatura o rascunho do parecer é gravado como assinado
 * (`updateUnsignedLegalOpinionDraft` nunca regrava um parecer assinado), o parecer é materializado como documento
 * oficial emitido em nome do signatário e o workspace passa a "assinado". Por isso o clique NÃO muta: abre uma
 * confirmação explícita com esse efeito; só "Assinar e tornar imutável" chama a mutação. A autoridade para assinar
 * (atribuição — NEW-007) continua sendo verificada no servidor; esta tela não a decide.
 */
export type SignatureMethodUI = "manual" | "icp_brasil" | "gov_br" | "certificado_a1";

const METHOD_LABELS: Record<SignatureMethodUI, string> = {
  manual: "Manual", icp_brasil: "ICP-Brasil", gov_br: "GOV.BR", certificado_a1: "Certificado A1",
};

export const SIGN_CONFIRM_TITLE = "Assinar o parecer?";
export const SIGN_CONFIRM_ACTION = "Assinar e tornar imutável";
export const SIGN_CONFIRM_CANCEL = "Continuar revisando";
export const SIGN_CONFIRM_PENDING = "Assinando…";

/** Efeitos reais, em ordem — exibidos ANTES da assinatura. */
export function signConfirmEffects(method: SignatureMethodUI): string[] {
  return [
    `A assinatura (${METHOD_LABELS[method]}) é registrada em seu nome e não pode ser desfeita nesta tela.`,
    "O parecer assinado passa a ser imutável: o texto não poderá mais ser editado.",
    "O parecer é emitido como documento oficial (versão emitida) e o processo de parecer passa a “assinado”.",
    "Só o procurador atribuído ao parecer pode assinar; sem a atribuição, o servidor recusa e nada é gravado.",
  ];
}
