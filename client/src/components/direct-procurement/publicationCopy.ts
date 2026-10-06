/**
 * SEM-060 — o rótulo do botão de publicação diz o EFEITO REAL do `directProcurement.publish`:
 * (1) gera os documentos de publicação (aviso, ratificação, extrato; + instruções/cronograma no presencial) e
 * (2) em seguida move o processo para a etapa "Publicação" (a transição canônica — LEG-011 aponta `publish` como a
 * alternativa ao salto genérico de etapa). Gerar os documentos NÃO os publica nos veículos oficiais.
 */
export const PUBLISH_BUTTON_LABEL = "Gerar publicações e avançar para a etapa Publicação";
export const PUBLISH_BUTTON_PENDING = "Gerando e avançando…";

export const PUBLISH_EFFECT_NOTE =
  "Esta ação gera os documentos de publicação e, em seguida, move o processo para a etapa Publicação. Gerar os documentos não os publica nos veículos oficiais.";

export const PUBLICATIONS_EMPTY_HINT =
  "Ainda não há publicações geradas. Ao gerar, o processo avança para a etapa Publicação.";

/** `stageLabel` = etapa efetiva devolvida pelo servidor (nunca presumida pela tela). */
export function publishSuccessMessage(count: number, stageLabel: string): string {
  return `${count} documento(s) de publicação gerado(s). O processo avançou para a etapa ${stageLabel}.`;
}
