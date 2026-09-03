/**
 * Sincronização de estado da UI do Parecer Jurídico após mutações bem-sucedidas.
 *
 * O backend é a AUTORIDADE. Depois que uma mutação institucional confirma SUCCESS
 * (assinatura, devolução), as queries canônicas que alimentam a tela precisam ser
 * invalidadas/refeitas para a UI CONVERGIR automaticamente — sem `F5`, sem reload,
 * sem optimistic update inventando estado antes da confirmação do servidor.
 *
 * Módulo PURO e testável: recebe um invalidador (as fontes canônicas) e apenas dispara
 * as invalidações corretas. Não conhece tRPC/React; não executa mutações; não decide
 * nada institucional. Assim as regressões provam o conjunto exato de queries afetadas.
 */

/** Fontes canônicas de leitura da tela do Parecer que dependem do estado pós-mutação. */
export interface OpinionQueryInvalidator {
  /** legalOpinionWorkspace.loadContext({ workspaceId }) — card/stage, draft, versões, timeline. */
  loadContext: (workspaceId: string) => void;
  /** legalOpinionWorkspace.listInbox — Caixa Institucional (pendentes + em andamento). */
  listInbox: () => void;
  /** legalOpinionWorkspace.lawyerDashboard — Painel do Procurador (contadores). */
  lawyerDashboard: () => void;
  /** documentEngine.list({ businessDomain: parecer_juridico, origin: workspaceId }) —
   *  Documentos Oficiais do Parecer (versão emitida + botões DOCX/PDF/Imprimir). */
  officialDocuments: (workspaceId: string) => void;
}

/**
 * Após ASSINAR com SUCCESS: a versão oficial `emitido` foi materializada e o workspace
 * passou a `SIGNED`. Converge o contexto (card "Assinado", stage, versões), a lista de
 * Documentos Oficiais (para exibir `v · emitido` + DOCX/PDF/Imprimir SEM reload), a Caixa
 * (o card muda de estado) e o Painel do Procurador (contadores).
 */
export function invalidateAfterSign(inv: OpinionQueryInvalidator, workspaceId: string): void {
  inv.loadContext(workspaceId);
  inv.officialDocuments(workspaceId);
  inv.listInbox();
  inv.lawyerDashboard();
}

/**
 * Após DEVOLVER à origem com SUCCESS: o parecer voltou ao domínio solicitante e saiu da
 * caixa ativa do Procurador. Converge a Caixa (pendências/andamento passam a não listar o
 * trabalho), o Painel do Procurador e o contexto do workspace devolvido.
 */
export function invalidateAfterReturn(inv: OpinionQueryInvalidator, workspaceId: string): void {
  inv.listInbox();
  inv.lawyerDashboard();
  inv.loadContext(workspaceId);
}
