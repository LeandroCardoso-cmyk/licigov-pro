/**
 * Centro de Operações — ações de ciclo de vida na lista de Registros (componente REAL, react-dom/server).
 * Dados sintéticos; tRPC mockado.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ records: [] as unknown[], lastQuery: null as unknown }));
const mutation = vi.hoisted(() => () => ({ mutate: () => {}, reset: () => {}, isPending: false, isError: false, error: null }));
vi.mock("../../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    operationRecord: {
      listRecords: { useQuery: (input: unknown) => { state.lastQuery = input; return { data: { records: state.records }, isLoading: false, isError: false }; } },
      setSchedule: { useMutation: mutation },
      createEvent: { useMutation: mutation },
      complete: { useMutation: mutation },
      reopen: { useMutation: mutation },
    },
  },
}));

import OperationalRecordList from "./OperationalRecordList";
import { LIFECYCLE_CONFIRM, LIFECYCLE_FILTERS, recordActions } from "./recordLifecycle";

const row = (over: Record<string, unknown>) => ({
  id: "r".padEnd(20, "0"), recordType: "processo_licitatorio_legado", origin: "interna", number: "1/2026", object: "Objeto fictício",
  modality: "Pregão", currentStage: "Em andamento", responsible: null, eventDate: "", eventEndDate: "", eventTime: "",
  createdAt: "2026-01-01T00:00:00.000Z", lifecycleStatus: "active", completedAt: null, completedBy: null, ...over,
});
const render = () => renderToStaticMarkup(createElement(OperationalRecordList, {}));

describe("Registros — ciclo de vida na lista", () => {
  it("padrão lista ATIVOS; filtros Ativos | Concluídos | Todos", () => {
    state.records = [row({})];
    const html = render();
    expect(state.lastQuery).toMatchObject({ lifecycle: "active" });
    expect(LIFECYCLE_FILTERS.map((f) => f.label)).toEqual(["Ativos", "Concluídos", "Todos"]);
    expect(html).toContain('aria-label="Filtrar registros por situação"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Ativos</);
  });

  it("registro ativo: Definir data / Adicionar evento / Concluir; sem data ⇒ 'Sem data'", () => {
    state.records = [row({})];
    const html = render();
    expect(html).toContain(">Definir data<");
    expect(html).toContain(">Adicionar evento<");
    expect(html).toContain(">Concluir<");
    expect(html).not.toContain(">Reabrir<");
    expect(html).toContain("Sem data");
  });

  it("registro ativo com agenda: 'Editar agenda'; sem horário ⇒ Dia inteiro; com horário ⇒ horário", () => {
    state.records = [row({ eventDate: "2026-01-20" }), row({ id: "s".padEnd(20, "0"), eventDate: "2026-11-03", eventTime: "10:15" })];
    const html = render();
    expect(html).toContain(">Editar agenda<");
    expect(html).toContain("Dia inteiro");
    expect(html).toContain("10:15");
  });

  it("registro concluído: somente Reabrir (sem agenda/evento/concluir) e selo de concluído", () => {
    state.records = [row({ lifecycleStatus: "completed", completedAt: "2026-09-29T12:00:00.000Z", eventDate: "2026-01-20" })];
    const html = render();
    expect(html).toContain(">Reabrir<");
    expect(html).not.toContain(">Concluir<");
    expect(html).not.toContain(">Definir data<");
    expect(html).not.toContain(">Adicionar evento<");
    expect(html).toContain("Concluído em");
  });

  it("confirmação com a mensagem institucional (nada é excluído) e ações por estado", () => {
    expect(LIFECYCLE_CONFIRM.complete).toEqual({
      title: "Concluir este registro operacional?",
      description: "Ele deixará de aparecer nas visões operacionais e no calendário, mas continuará disponível no histórico. Nenhum dado será excluído.",
      confirm: "Concluir registro",
    });
    expect(LIFECYCLE_CONFIRM.reopen.confirm).toBe("Reabrir registro");
    expect(recordActions("active")).toEqual(["schedule", "addEvent", "complete"]);
    expect(recordActions("completed")).toEqual(["reopen"]);
    expect(recordActions(undefined)).toEqual(["schedule", "addEvent", "complete"]);
  });
});
