/**
 * Utilitários para manipulação de datas e fuso horário
 * 
 * O banco de dados armazena datas em UTC, mas precisamos exibir
 * e trabalhar com datas no fuso horário de Brasília (America/Sao_Paulo)
 */

/**
 * Converte data UTC do banco para data local do Brasil
 * @param utcDate - Data em UTC vinda do banco de dados
 * @returns Date object ajustado para America/Sao_Paulo
 */
export function utcToBrazil(utcDate: Date | string | null | undefined): Date | null {
  if (!utcDate) return null;
  
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  
  // Converter para string no formato ISO com timezone de Brasília
  const brazilTimeString = date.toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
  });
  
  return new Date(brazilTimeString);
}

/**
 * Converte data local do Brasil para UTC (para salvar no banco)
 * @param brazilDate - Data no fuso horário de Brasília
 * @returns Date object em UTC
 */
export function brazilToUTC(brazilDate: Date | string): Date {
  const date = typeof brazilDate === 'string' ? new Date(brazilDate) : brazilDate;
  return date; // JavaScript Date já lida com UTC internamente
}

/**
 * Formata data para exibição no formato brasileiro
 * @param date - Data a ser formatada
 * @param includeTime - Se deve incluir hora (padrão: false)
 * @returns String formatada (ex: "13/11/2025" ou "13/11/2025 15:30")
 */
export function formatBrazilDate(
  date: Date | string | null | undefined,
  includeTime: boolean = false
): string {
  if (!date) return '-';
  
  const brazilDate = utcToBrazil(date);
  if (!brazilDate) return '-';
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  };
  
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  
  return brazilDate.toLocaleString('pt-BR', options);
}

/**
 * Retorna a data/hora atual no fuso horário de Brasília
 * @returns Date object com hora atual de Brasília
 */
export function nowInBrazil(): Date {
  const now = new Date();
  return utcToBrazil(now) || now;
}

/**
 * Calcula diferença de tempo relativa (ex: "há 5 minutos", "há 2 horas")
 * @param date - Data a ser comparada com agora
 * @returns String com tempo relativo
 */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return '-';
  
  const brazilDate = utcToBrazil(date);
  if (!brazilDate) return '-';
  
  const now = nowInBrazil();
  const diffMs = now.getTime() - brazilDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) return 'agora mesmo';
  if (diffMinutes < 60) return `há ${diffMinutes} minuto${diffMinutes > 1 ? 's' : ''}`;
  if (diffHours < 24) return `há ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
  if (diffDays < 30) return `há ${diffDays} dia${diffDays > 1 ? 's' : ''}`;
  
  return formatBrazilDate(date);
}
