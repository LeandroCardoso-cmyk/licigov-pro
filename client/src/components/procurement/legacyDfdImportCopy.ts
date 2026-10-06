/**
 * SEM-060 — o caminho LEGADO "Importar DFD" (exibido só com a importação documental desligada) NÃO importa conteúdo:
 * `procurementProcess.importDFD` apenas registra no histórico do processo que um DFD de origem foi informado
 * (não lê arquivo, não cria nem altera o DFD). O rótulo e o retorno dizem exatamente isso.
 */
export const LEGACY_DFD_REGISTER_TITLE = "Registrar origem de um DFD existente (sem importar o conteúdo)";
export const LEGACY_DFD_REGISTER_NOTE =
  "Esta ação só registra, no histórico do processo, que existe um DFD de origem. Ela não lê o arquivo, não importa o conteúdo e não cria o DFD — para ter o DFD aqui, use “Criar DFD do zero” e preencha o texto.";
export const LEGACY_DFD_REGISTER_BUTTON = "Registrar no histórico";
export const LEGACY_DFD_REGISTER_PENDING = "Registrando…";
export const LEGACY_DFD_REGISTER_ERROR = "Falha ao registrar a origem do DFD no histórico.";

export function legacyDfdRegisteredMessage(sourceLabel: string): string {
  return `Registrado no histórico do processo: DFD de origem (${sourceLabel}). O conteúdo NÃO foi importado e nenhum DFD foi criado.`;
}
