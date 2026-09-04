/**
 * Orquestração das QUERIES da tela do Parecer (lógica pura, testável sem DOM).
 *
 * O cliente tRPC global usa `httpBatchLink`: queries habilitadas no MESMO tick de
 * render podem ser agrupadas na MESMA requisição HTTP. Se `loadContext` (DB, rápido)
 * e `loadReasoning` (Kernel → RAG → LLM, lento) fossem habilitadas juntas, a resposta
 * operacional ficaria refém do batch que carrega a IA — neutralizando o desacoplamento.
 *
 * A regra abaixo garante que `loadReasoning` só é habilitado DEPOIS que o conteúdo
 * operacional (`loadContext`) chegou com SUCCESS — forçando uma SEGUNDA requisição HTTP,
 * separada do batch inicial. Sem tocar no `httpBatchLink` global, sem transporte
 * paralelo, sem timeout/setTimeout artificial.
 */

/** loadReasoning só habilita após o conteúdo operacional (loadContext) estar disponível. */
export function reasoningQueryEnabled(p: {
  /** Um workspace foi selecionado (loadContext pode iniciar). */
  workspaceSelected: boolean;
  /** loadContext retornou SUCCESS — os dados operacionais já estão na tela. */
  contextLoaded: boolean;
}): boolean {
  return p.workspaceSelected && p.contextLoaded;
}

/**
 * Estado de APRESENTAÇÃO do bloco Reasoning & Explainability. Distingue explicitamente
 * "apoio ainda não solicitado" (idle), "processando" (loading), "indisponível por FALHA"
 * (error) e "resultado válido" (ready) — para nunca exibir falha como se fosse um
 * resultado vazio válido (ex.: confiança 0% / "sem reasoning gerado").
 */
export type ReasoningViewState = "idle" | "loading" | "error" | "ready";

export function reasoningViewState(p: {
  /** Resultado de `reasoningQueryEnabled` — a query pode executar. */
  enabled: boolean;
  /** A query está buscando (inclui refetch/tentar novamente). */
  isFetching: boolean;
  /** A query terminou em erro (falha/indisponibilidade do apoio cognitivo). */
  isError: boolean;
  /** Já existe um resultado de reasoning carregado. */
  hasData: boolean;
}): ReasoningViewState {
  if (!p.enabled) return "idle";        // ainda esperando o conteúdo operacional
  if (p.hasData) return "ready";        // resultado válido (mantém-se mesmo em refetch de fundo)
  if (p.isFetching) return "loading";   // processando / tentando novamente
  if (p.isError) return "error";        // falhou sem dado → estado institucional explícito
  return "loading";                     // habilitado, sem dado e prestes a buscar
}
