/**
 * Prompt Builder — arquitetura escalável de composição de contexto para IA.
 *
 * Em vez de prompts gigantes hardcoded, cada função de sugestão monta seu
 * contexto a partir de peças reutilizáveis, mantendo os prompts enxutos e
 * o contexto relevante.
 */

export interface ProcessContext {
  name: string;
  object: string;
  estimatedValue: number;
  modality?: string | null;
  category?: string | null;
  dfdContent?: string | null;
  etpContent?: string | null;
  trContent?: string | null;
  editalContent?: string | null;
  contratoContent?: string | null;
}

export interface OrgContext {
  organizationName?: string;
  cnpj?: string;
}

/** Formata valor em reais */
export function fmtBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Trunca texto para caber em contexto sem desperdiçar tokens */
export function truncate(text: string | null | undefined, maxChars = 1500): string {
  if (!text) return "(não disponível)";
  return text.length > maxChars ? text.slice(0, maxChars) + "\n...[truncado]" : text;
}

/** Bloco de dados do processo — reutilizável em qualquer prompt */
export function processBlock(ctx: ProcessContext): string {
  return `**DADOS DO PROCESSO:**
- Nome: ${ctx.name}
- Objeto: ${ctx.object}
- Valor estimado: ${fmtBrl(ctx.estimatedValue)}
- Modalidade: ${ctx.modality || "(não definida)"}
- Categoria: ${ctx.category || "(não definida)"}`;
}

/** Bloco de contexto dos documentos já existentes */
export function documentsBlock(ctx: ProcessContext): string {
  const parts: string[] = [];
  if (ctx.dfdContent) parts.push(`**DFD:**\n${truncate(ctx.dfdContent, 800)}`);
  if (ctx.etpContent) parts.push(`**ETP:**\n${truncate(ctx.etpContent, 800)}`);
  if (ctx.trContent)  parts.push(`**TR:**\n${truncate(ctx.trContent, 800)}`);
  if (ctx.editalContent) parts.push(`**Edital:**\n${truncate(ctx.editalContent, 600)}`);
  if (ctx.contratoContent) parts.push(`**Contrato:**\n${truncate(ctx.contratoContent, 600)}`);
  return parts.length ? parts.join("\n\n") : "(nenhum documento elaborado ainda)";
}

/** Instrução de saída padrão para respostas estruturadas em Markdown */
export function outputInstruction(format: string): string {
  return `**FORMATO DE SAÍDA:**\n${format}\n\nResponda apenas com o conteúdo solicitado, sem preâmbulos.`;
}
