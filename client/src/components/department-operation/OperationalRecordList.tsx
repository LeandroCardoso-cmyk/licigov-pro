import React from "react";
import { trpc } from "../../lib/trpc";
import { formatDate, RECORD_TYPE_LABELS } from "./labels";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  EMPTY_LIST_MESSAGE, LIFECYCLE_CONFIRM, LIFECYCLE_FILTERS, recordActions, type RecordLifecycleFilter,
} from "./recordLifecycle";

type ScheduleDraft = { eventDate: string; eventEndDate: string; eventTime: string };
type ExtraEventDraft = { eventType: "certame" | "sessao_publica" | "reuniao" | "audiencia" | "visita_tecnica" | "assinatura" | "tarefa" | "manual"; title: string; eventDate: string; eventTime: string };

export default function OperationalRecordList({ focusRecordId }: { focusRecordId?: string | null }) {
  const utils = trpc.useUtils();
  const [lifecycle, setLifecycle] = React.useState<RecordLifecycleFilter>("active");
  const { data, isLoading, isError } = trpc.operationRecord.listRecords.useQuery({ limit: 200, lifecycle });
  const records = data?.records ?? [];
  const [pendingTransition, setPendingTransition] = React.useState<{ id: string; label: string; action: "complete" | "reopen" } | null>(null);
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
  const completeRecord = trpc.operationRecord.complete.useMutation({ onSuccess: () => { refresh(); setPendingTransition(null); } });
  const reopenRecord = trpc.operationRecord.reopen.useMutation({ onSuccess: () => { refresh(); setPendingTransition(null); } });
  const transitionPending = completeRecord.isPending || reopenRecord.isPending;
  const transitionError = completeRecord.error?.message ?? reopenRecord.error?.message ?? null;
  const confirmTransition = () => {
    if (!pendingTransition || transitionPending) return; // impede duplo clique
    if (pendingTransition.action === "complete") completeRecord.mutate({ recordId: pendingTransition.id });
    else reopenRecord.mutate({ recordId: pendingTransition.id });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Registros cadastrados</h2>
        <div role="group" aria-label="Filtrar registros por situação" className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs font-medium">
          {LIFECYCLE_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={lifecycle === f.key} onClick={() => setLifecycle(f.key)}
              className={`rounded-md px-3 py-1 transition ${lifecycle === f.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {transitionError && !pendingTransition && <p role="alert" className="mt-2 text-xs text-destructive">{transitionError}</p>}
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Carregando registros…</p>
        : isError ? <p className="mt-3 text-sm text-destructive">Não foi possível carregar os registros.</p>
          : records.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{EMPTY_LIST_MESSAGE[lifecycle]}</p>
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
                        {recordActions(record.lifecycleStatus).includes("schedule") && <button type="button" className="mr-2 text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => {
                          setAddingEventId(null); setEditingId(record.id);
                          setSchedule({ eventDate: record.eventDate, eventEndDate: record.eventEndDate, eventTime: record.eventTime });
                        }}>{record.eventDate ? "Editar agenda" : "Definir data"}</button>}
                        {recordActions(record.lifecycleStatus).includes("addEvent") && <button type="button" className="mr-2 text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => {
                          setEditingId(null); setAddingEventId(record.id);
                          setExtraEvent({ eventType: "certame", title: `Certame — ${record.object || record.number}`, eventDate: "", eventTime: "" });
                        }}>Adicionar evento</button>}
                        {recordActions(record.lifecycleStatus).includes("complete") && <button type="button" disabled={transitionPending} className="text-muted-foreground hover:underline disabled:pointer-events-none disabled:text-muted-foreground" onClick={() => {
                          completeRecord.reset(); setPendingTransition({ id: record.id, label: record.object || record.number, action: "complete" });
                        }}>Concluir</button>}
                        {recordActions(record.lifecycleStatus).includes("reopen") && <>
                          <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Concluído{record.completedAt ? ` em ${formatDate(record.completedAt.slice(0, 10))}` : ""}</span>
                          <button type="button" disabled={transitionPending} className="text-indigo-600 hover:underline disabled:pointer-events-none disabled:text-muted-foreground dark:text-indigo-300" onClick={() => {
                            reopenRecord.reset(); setPendingTransition({ id: record.id, label: record.object || record.number, action: "reopen" });
                          }}>Reabrir</button>
                        </>}
                      </td>
                    </tr>
                    {editingId === record.id && <tr><td colSpan={6} className="bg-muted/40 p-3">
                      <form onSubmit={(e) => { e.preventDefault(); saveSchedule.mutate({ recordId: record.id, ...schedule }); }} className="flex flex-wrap items-end gap-3">
                        <label className="text-xs">Data do evento<input aria-label="Data do evento" type="date" value={schedule.eventDate} onChange={(e) => setSchedule({ ...schedule, eventDate: e.target.value, eventEndDate: e.target.value ? schedule.eventEndDate : "", eventTime: e.target.value ? schedule.eventTime : "" })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <label className="text-xs">Data final (opcional)<input aria-label="Data final" type="date" value={schedule.eventEndDate} min={schedule.eventDate || undefined} disabled={!schedule.eventDate} onChange={(e) => setSchedule({ ...schedule, eventEndDate: e.target.value })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <label className="text-xs">Horário (opcional)<input aria-label="Horário do evento" type="time" value={schedule.eventTime} disabled={!schedule.eventDate} onChange={(e) => setSchedule({ ...schedule, eventTime: e.target.value })} className="mt-1 block rounded border border-input bg-background p-1" /></label>
                        <button type="submit" disabled={saveSchedule.isPending} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:bg-muted disabled:text-muted-foreground">Salvar data</button>
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
                        <button type="submit" disabled={addEvent.isPending} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:bg-muted disabled:text-muted-foreground">Salvar evento</button>
                        <button type="button" onClick={() => setAddingEventId(null)} className="text-xs text-muted-foreground">Cancelar</button>
                        {addEvent.isError && <span role="alert" className="text-xs text-destructive">{addEvent.error.message}</span>}
                      </form>
                    </td></tr>}
                  </React.Fragment>)}</tbody>
                </table>
              </div>
            )}
      <AlertDialog open={pendingTransition !== null} onOpenChange={(open) => { if (!open && !transitionPending) setPendingTransition(null); }}>
        {pendingTransition && <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{LIFECYCLE_CONFIRM[pendingTransition.action].title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTransition.label ? <><strong className="text-foreground">{pendingTransition.label}</strong><br /></> : null}
              {LIFECYCLE_CONFIRM[pendingTransition.action].description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {transitionError && <p role="alert" className="text-sm text-destructive">{transitionError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transitionPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={transitionPending} onClick={(e) => { e.preventDefault(); confirmTransition(); }}>
              {transitionPending ? "Salvando…" : LIFECYCLE_CONFIRM[pendingTransition.action].confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>}
      </AlertDialog>
    </section>
  );
}
