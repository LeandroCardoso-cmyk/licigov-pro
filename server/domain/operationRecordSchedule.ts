/** Datas locais do calendário institucional: strings ISO, sem conversão de fuso. */
export interface OperationRecordSchedule {
  eventDate: string;
  eventEndDate: string;
  eventTime: string;
}

export function validLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function assertOperationRecordSchedule(schedule: OperationRecordSchedule): void {
  const { eventDate, eventEndDate, eventTime } = schedule;
  if (!eventDate) {
    if (eventEndDate || eventTime) throw new Error("Informe a data do evento antes do término ou horário.");
    return;
  }
  if (!validLocalDate(eventDate)) throw new Error("Data do evento inválida.");
  if (eventEndDate && (!validLocalDate(eventEndDate) || eventEndDate < eventDate)) {
    throw new Error("A data final deve ser válida e igual ou posterior à data inicial.");
  }
  if (eventTime && !validLocalTime(eventTime)) throw new Error("Horário do evento inválido.");
}

export function isFinalizedOperationRecord(stage: string): boolean {
  if (stage.trim() === "✔") return true;
  const normalized = stage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return /^(finalizado|concluido|encerrado)\b/.test(normalized);
}
