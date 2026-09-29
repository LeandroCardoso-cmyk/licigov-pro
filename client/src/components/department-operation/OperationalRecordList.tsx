import React from "react";
import { trpc } from "../../lib/trpc";
import { formatDate, RECORD_TYPE_LABELS } from "./labels";

type ScheduleDraft = { eventDate: string; eventEndDate: string; eventTime: string };
type ExtraEventDraft = { eventType: "certame" | "sessao_publica" | "reuniao" | "audiencia" | "visita_tecnica" | "assinatura" | "tarefa" | "manual"; title: string; eventDate: string; eventTime: string };

export default function OperationalRecordList({ focusRecordId }: { focusRecordId?: string | null }) {
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.operationRecord.listRecords.useQuery({ limit: 200 });
  const records = data?.records ?? [];
  React.useEffect(() => {
    if (focusRecordId && !isLoading) document.getElementById(`operational-record-${focusRecordId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRecordId, isLoading]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [addingEventId, setAddingEventId] = React.useState<string | null>(null);
  const [schedule, setSchedule] = React.useState<ScheduleDraft>({ eventDate: "", eventEndDate: "", eventTime: "" });
  const [extraEvent, setExtraEvent] = React.useState<ExtraEventDraft>({ eventType: "certame", title: "", eventDate: "", eventTime: "" });
  const refresh = () => {
    void utils.operationRecord.listRecords.invalidate();
    void utils.departmentOperation.dashboard.invalidate();
    void utils.departmentOperation.indicators.invalidate();
    void utils.departmentOperation.monitoringPanel.invalidate();
    void utils.departmentOperation.calendar.invalidate();
    void utils.departmentOperation.timeline.invalidate();
  };
  const saveSchedule = trpc.operationRecord.setSchedule.useMutation({ onSuccess: () => { refresh(); setEditingId(null); } });
  const addEvent = trpc.operationRecord.createEvent.useMutation({ onSuccess: () => { refresh(); setAddingEventId(null); } });

  return (
    <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <h2 className="text-base font-semibold text-foreground">Registros cadastrados</h2>
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Carregando registros…</p>
        : isError ? <p className="mt-3 text-sm text-destructive">Não foi possível carregar os registros.</p>
          : records.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhum registro cadastrado.</p>
            : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-border text-muted-foreground">
                    <th className="px-2 py-2">Número</th><th className="px-2 py-2">Objeto</th>
                    <th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Etapa atual</th>
                    <th className="px-2 py-2">Agenda</th><th className="px-2 py-2">Ações</th>
                  </tr></thead>
                  <tbody>{records.map((record) => <React.Fragment key={record.id}>
                    <tr id={`operational-record-${record.id}`} className={`border-b border-border/60 ${focusRecordId === record.id ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}`}>
                      <td className="px-2 py-2">{record.number || "—"}</td>
                      <td className="px-2 py-2">{record.object || "—"}</td>
                      <td className="px-2 py-2">{RECORD_TYPE_LABELS[record.recordType] ?? record.recordType}</td>
                      <td className="px-2 py-2">{record.currentStage || "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{record.eventDate ? `${formatDate(record.eventDate)}${record.eventEndDate ? ` a ${formatDate(record.eventEndDate)}` : ""} · ${record.eventTime || "Dia inteiro"}` : "Sem data"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <button type="button" className="mr-2 text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => {
                          setAddingEventId(null); setEditingId(record.id);
                          setSchedule({ eventDate: record.eventDate, eventEndDate: record.eventEndDate, eventTime: record.eventTime });
                        }}>Definir data</button>
                        <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => {
                          setEditingId(null); setAddingEventId(record.id);
                          setExtraEvent({ eventType: "certame", title: `Certame — ${record.object || record.number}`, eventDate: "", eventTime: "" });
                        }}>Adicionar evento</button>
                      </td>
                    </tr>
                    {editingId === record.id && <tr><td colSpan={6} className="bg-muted/40 p-3">
                      <form onSubmit={(e) => { e.preventDefault(); saveSchedule.mutate({ recordId: record.id, ...schedule }); }} className="flex flex-wrap items-end gap-3">
                        <label className="text-xs">Data do evento<input aria-label="Data do evento" type="date" value={schedule.eventDate} onChange={(e) => setSchedule({ ...schedule, eventDate: e.target.value, eventEndDate: e.target.value ? schedule.eventEndDate : "", eventTime: e.target.value ? schedule.eventTime : "" })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <label className="text-xs">Data final (opcional)<input aria-label="Data final" type="date" value={schedule.eventEndDate} min={schedule.eventDate || undefined} disabled={!schedule.eventDate} onChange={(e) => setSchedule({ ...schedule, eventEndDate: e.target.value })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <label className="text-xs">Horário (opcional)<input aria-label="Horário do evento" type="time" value={schedule.eventTime} disabled={!schedule.eventDate} onChange={(e) => setSchedule({ ...schedule, eventTime: e.target.value })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <button type="submit" disabled={saveSchedule.isPending} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">Salvar data</button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-xs text-muted-foreground">Cancelar</button>
                        {saveSchedule.isError && <span role="alert" className="text-xs text-destructive">{saveSchedule.error.message}</span>}
                      </form>
                    </td></tr>}
                    {addingEventId === record.id && <tr><td colSpan={6} className="bg-muted/40 p-3">
                      <form onSubmit={(e) => { e.preventDefault(); addEvent.mutate({ ...extraEvent, referenceType: "operation_record", referenceId: record.id }); }} className="flex flex-wrap items-end gap-3">
                        <label className="text-xs">Tipo<select aria-label="Tipo do evento" value={extraEvent.eventType} onChange={(e) => setExtraEvent({ ...extraEvent, eventType: e.target.value as ExtraEventDraft["eventType"] })} className="mt-1 block rounded border border-input bg-background p-1"><option value="certame">Certame</option><option value="sessao_publica">Sessão pública</option><option value="reuniao">Reunião</option><option value="audiencia">Audiência</option><option value="visita_tecnica">Visita técnica</option><option value="assinatura">Assinatura</option><option value="tarefa">Tarefa</option><option value="manual">Outro evento</option></select></label>
                        <label className="min-w-40 flex-1 text-xs">Título<input aria-label="Título do evento" required value={extraEvent.title} onChange={(e) => setExtraEvent({ ...extraEvent, title: e.target.value })} className="mt-1 block w-full rounded border border-input bg-background p-1" /></label>
                        <label className="text-xs">Data<input aria-label="Data do novo evento" required type="date" value={extraEvent.eventDate} onChange={(e) => setExtraEvent({ ...extraEvent, eventDate: e.target.value })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <label className="text-xs">Horário<input aria-label="Horário do novo evento" type="time" value={extraEvent.eventTime} onChange={(e) => setExtraEvent({ ...extraEvent, eventTime: e.target.value })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <button type="submit" disabled={addEvent.isPending} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">Salvar evento</button>
                        <button type="button" onClick={() => setAddingEventId(null)} className="text-xs text-muted-foreground">Cancelar</button>
                        {addEvent.isError && <span role="alert" className="text-xs text-destructive">{addEvent.error.message}</span>}
                      </form>
                    </td></tr>}
                  </React.Fragment>)}</tbody>
                </table>
              </div>
            )}
    </section>
  );
}
