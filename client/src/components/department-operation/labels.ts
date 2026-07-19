/**
 * FASE 5 — Centro de Operações: rótulos e estilos compartilhados (pt-BR).
 */

export const SITUATION_CLASSES: Record<string, string> = {
  verde: "bg-green-100 text-green-800 ring-green-500/20",
  amarelo: "bg-amber-100 text-amber-800 ring-amber-500/20",
  azul: "bg-blue-100 text-blue-800 ring-blue-500/20",
  vermelho: "bg-red-100 text-red-700 ring-red-500/20",
  cinza: "bg-muted text-muted-foreground ring-gray-500/20",
};

export const SITUATION_LABELS: Record<string, string> = {
  verde: "Concluído", amarelo: "Em andamento", azul: "Evento futuro", vermelho: "Atrasado", cinza: "Não iniciado",
};

export const RECORD_TYPE_LABELS: Record<string, string> = {
  processo_licitatorio_legado: "Processo Licitatório Legado",
  contratacao_direta_legada: "Contratação Direta Legada",
  contrato_externo: "Contrato Externo",
  aditivo_externo: "Aditivo Externo",
  ata_externa: "Ata Externa",
  parecer_externo: "Parecer Externo",
  reuniao: "Reunião", evento: "Evento", tarefa: "Tarefa", outro: "Outro",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  sessao_publica: "Sessão Pública", certame: "Certame", reuniao: "Reunião", audiencia: "Audiência",
  visita_tecnica: "Visita Técnica", assinatura: "Assinatura",
  vencimento_contrato: "Vencimento de Contrato", vencimento_aditivo: "Vencimento de Aditivo",
  vencimento_ata: "Vencimento de Ata", tarefa: "Tarefa", manual: "Evento",
};

export const EVENT_TYPE_CLASSES: Record<string, string> = {
  sessao_publica: "bg-indigo-100 text-indigo-800", certame: "bg-indigo-100 text-indigo-800",
  reuniao: "bg-blue-100 text-blue-800", audiencia: "bg-blue-100 text-blue-800", visita_tecnica: "bg-blue-100 text-blue-800",
  assinatura: "bg-purple-100 text-purple-800",
  vencimento_contrato: "bg-red-100 text-red-700", vencimento_aditivo: "bg-red-100 text-red-700", vencimento_ata: "bg-red-100 text-red-700",
  tarefa: "bg-amber-100 text-amber-800", manual: "bg-muted text-foreground",
};

export const CHANNEL_LABELS: Record<string, string> = {
  pncp: "PNCP", orgao_oficial: "Órgão Oficial", diario_oficial: "Diário Oficial", portal: "Portal", jornal: "Jornal",
};

export function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
