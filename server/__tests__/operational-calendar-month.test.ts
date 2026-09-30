/**
 * Calendário Operacional Visual v1 — domínio puro da grade mensal (dados sintéticos).
 */
import { describe, expect, it } from "vitest";
import {
  buildMonthGrid, classifyCalendarItem, groupItemsByDay, listForMonthSelection, monthGridRange, monthLabel,
  monthNavigationReducer, shiftMonth, timeLabelFor, visibleSpan, type OperationalCalendarItem,
} from "@shared/operationalCalendar";

const item = (over: Partial<OperationalCalendarItem> & Pick<OperationalCalendarItem, "id" | "eventDate">): OperationalCalendarItem => ({
  eventType: "manual", title: `Item ${over.id}`, eventEndDate: "", eventTime: "", referenceType: "operation_record", referenceId: over.id, ...over,
});

describe("grade mensal — estrutura", () => {
  it("começa no domingo e termina no sábado, com semanas completas (5 ou 6)", () => {
    // Outubro/2026 começa numa quinta e termina num sábado.
    expect(monthGridRange("2026-10")).toEqual({ from: "2026-09-27", to: "2026-10-31", weekCount: 5 });
    // Agosto/2026 começa num sábado ⇒ 6 semanas.
    expect(monthGridRange("2026-08")).toEqual({ from: "2026-07-26", to: "2026-09-05", weekCount: 6 });
    // Fevereiro/2026: 28 dias começando num domingo ⇒ exatamente 4 semanas.
    expect(monthGridRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28", weekCount: 4 });
  });

  it("marca dias fora do mês, hoje e o dia selecionado", () => {
    const grid = buildMonthGrid({ month: "2026-10", items: [], today: "2026-10-13", selectedDate: "2026-10-16" });
    const cells = grid.weeks.flat();
    expect(grid.weeks).toHaveLength(5);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    expect(cells.filter((c) => !c.inMonth).map((c) => c.date)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(cells.filter((c) => c.isToday).map((c) => c.date)).toEqual(["2026-10-13"]);
    expect(cells.filter((c) => c.isSelected).map((c) => c.date)).toEqual(["2026-10-16"]);
    expect(grid.label).toBe("outubro de 2026");
  });

  it("navega entre meses atravessando o ano", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2027-01")).toBe("janeiro de 2027");
  });
});

describe("grade mensal — distribuição e classificação", () => {
  const items = [
    item({ id: "rec-a", eventDate: "2026-10-05" }),
    item({ id: "certame", eventType: "certame", title: "Certame 31/2026", eventDate: "2026-10-13", eventTime: "09:30" }),
    item({ id: "reuniao", eventType: "reuniao", eventDate: "2026-10-13", eventTime: "14:00" }),
    item({ id: "rec-periodo", eventDate: "2026-09-29", eventEndDate: "2026-10-02" }),
    item({ id: "fora", eventDate: "2026-12-01" }),
    item({ id: "invalida", eventDate: "" }),
  ];

  it("coloca cada item no(s) dia(s) certo(s), inclusive períodos que cruzam o mês", () => {
    const grid = buildMonthGrid({ month: "2026-10", items, today: "2026-10-01" });
    const byDate = new Map(grid.weeks.flat().map((c) => [c.date, c.items.map((i) => i.item.id)]));
    expect(byDate.get("2026-10-05")).toEqual(["rec-a"]);
    expect(byDate.get("2026-10-13")).toEqual(["certame", "reuniao"]);
    for (const d of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]) expect(byDate.get(d)).toEqual(["rec-periodo"]);
    expect(byDate.get("2026-10-03")).toEqual([]);
    expect([...byDate.values()].flat()).not.toContain("fora");
    expect([...byDate.values()].flat()).not.toContain("invalida");
  });

  it("diferencia dia inteiro, com horário e certame", () => {
    expect(classifyCalendarItem({ eventType: "manual", eventTime: "" })).toBe("allDay");
    expect(classifyCalendarItem({ eventType: "reuniao", eventTime: "14:00" })).toBe("timed");
    expect(classifyCalendarItem({ eventType: "certame", eventTime: "09:30" })).toBe("certame");
    expect(classifyCalendarItem({ eventType: "sessao_publica", eventTime: "" })).toBe("certame");
    const cell = buildMonthGrid({ month: "2026-10", items, today: "2026-10-01" }).weeks.flat().find((c) => c.date === "2026-10-13")!;
    expect(cell.items.map((i) => [i.kind, i.timeLabel])).toEqual([["certame", "09:30"], ["timed", "14:00"]]);
    expect(timeLabelFor({ eventDate: "2026-10-05", eventTime: "" }, "2026-10-05")).toBe("Dia inteiro");
    expect(timeLabelFor({ eventDate: "2026-10-05", eventTime: "08:00" }, "2026-10-06")).toBe("Em andamento");
  });

  it("ordena o dia (dia inteiro antes, depois por horário) e aplica '+N' sem passar do limite visual", () => {
    const many = [
      item({ id: "t2", eventDate: "2026-10-20", eventTime: "15:00" }),
      item({ id: "t1", eventDate: "2026-10-20", eventTime: "08:00" }),
      item({ id: "d1", eventDate: "2026-10-20", title: "B" }),
      item({ id: "d0", eventDate: "2026-10-20", title: "A" }),
      item({ id: "t3", eventDate: "2026-10-20", eventTime: "17:00" }),
    ];
    const cell = buildMonthGrid({ month: "2026-10", items: many, today: "2026-10-01", maxVisiblePerDay: 3 }).weeks.flat().find((c) => c.date === "2026-10-20")!;
    expect(cell.items.map((i) => i.item.id)).toEqual(["d0", "d1", "t1", "t2", "t3"]);
    expect(cell.visible.map((i) => i.item.id)).toEqual(["d0", "d1"]);
    expect(cell.overflow).toBe(3);
    const exact = buildMonthGrid({ month: "2026-10", items: many.slice(0, 3), today: "2026-10-01", maxVisiblePerDay: 3 }).weeks.flat().find((c) => c.date === "2026-10-20")!;
    expect(exact.visible).toHaveLength(3);
    expect(exact.overflow).toBe(0);
  });

  it("não duplica itens repetidos pela origem (mesmo id)", () => {
    const dup = [item({ id: "x", eventDate: "2026-10-07" }), item({ id: "x", eventDate: "2026-10-07" })];
    expect(groupItemsByDay(dup, "2026-10-01", "2026-10-31")).toEqual([["2026-10-07", [dup[0]]]]);
  });

  it("é determinístico: mesma entrada ⇒ mesma grade", () => {
    const a = buildMonthGrid({ month: "2026-10", items, today: "2026-10-01", selectedDate: "2026-10-13" });
    const b = buildMonthGrid({ month: "2026-10", items: [...items].reverse(), today: "2026-10-01", selectedDate: "2026-10-13" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("lista inferior e navegação", () => {
  const items = [
    item({ id: "setembro", eventDate: "2026-09-29" }),
    item({ id: "a", eventDate: "2026-10-05" }),
    item({ id: "b", eventDate: "2026-10-13", eventTime: "09:30", eventType: "certame" }),
  ];

  it("sem seleção lista só o mês; com seleção lista só o dia", () => {
    expect(listForMonthSelection(items, "2026-10", null).map(([d]) => d)).toEqual(["2026-10-05", "2026-10-13"]);
    expect(listForMonthSelection(items, "2026-10", "2026-10-13")).toEqual([["2026-10-13", [items[2]]]]);
    expect(listForMonthSelection(items, "2026-10", "2026-10-14")).toEqual([]);
  });

  it("anterior/próximo limpam a seleção; hoje seleciona o dia atual; clicar de novo desmarca", () => {
    const start = { month: "2026-10", selectedDate: "2026-10-13" };
    expect(monthNavigationReducer(start, { type: "previous" })).toEqual({ month: "2026-09", selectedDate: null });
    expect(monthNavigationReducer(start, { type: "next" })).toEqual({ month: "2026-11", selectedDate: null });
    expect(monthNavigationReducer(start, { type: "today", today: "2026-09-29" })).toEqual({ month: "2026-09", selectedDate: "2026-09-29" });
    expect(monthNavigationReducer(start, { type: "select", date: "2026-10-13" })).toEqual({ month: "2026-10", selectedDate: null });
    expect(monthNavigationReducer(start, { type: "clearSelection" })).toEqual({ month: "2026-10", selectedDate: null });
  });

  it("clicar num dia de mês vizinho navega até ele; datas inválidas são ignoradas", () => {
    const start = { month: "2026-10", selectedDate: null };
    expect(monthNavigationReducer(start, { type: "select", date: "2026-09-29" })).toEqual({ month: "2026-09", selectedDate: "2026-09-29" });
    expect(monthNavigationReducer(start, { type: "goTo", date: "2027-02-10" })).toEqual({ month: "2027-02", selectedDate: "2027-02-10" });
    expect(monthNavigationReducer(start, { type: "select", date: "2026-02-30" })).toBe(start);
    expect(monthNavigationReducer(start, { type: "goTo", date: "" })).toBe(start);
  });
});

describe("grade mensal — períodos longos cobrem toda a janela visível", () => {
  // Agosto/2026: grade de 6 semanas (42 dias), de 26/07 a 05/09.
  const cellsWith = (grid: ReturnType<typeof buildMonthGrid>, id: string) =>
    grid.weeks.flat().filter((c) => c.items.some((i) => i.item.id === id)).map((c) => c.date);
  const allCells = (month: string) => buildMonthGrid({ month, items: [], today: "2026-08-01" }).weeks.flat().map((c) => c.date);

  it("período com mais de 31 dias visíveis aparece em TODOS os dias da grade, uma única vez (regressão)", () => {
    const longo = item({ id: "longo", eventDate: "2026-07-01", eventEndDate: "2026-12-31" });
    const grid = buildMonthGrid({ month: "2026-08", items: [longo], today: "2026-08-01" });
    expect(cellsWith(grid, "longo")).toEqual(allCells("2026-08"));
    for (const d of ["2026-08-26", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-05"]) {
      const cell = grid.weeks.flat().find((c) => c.date === d)!;
      expect(cell.items.filter((i) => i.item.id === "longo")).toHaveLength(1);
    }
  });

  it("grade e lista concordam em cada dia do mês (ex.: 30/08)", () => {
    const longo = item({ id: "longo", eventDate: "2026-07-26", eventEndDate: "2026-09-05" });
    const grid = buildMonthGrid({ month: "2026-08", items: [longo], today: "2026-08-01" });
    const byDate = new Map(grid.weeks.flat().map((c) => [c.date, c.items.map((i) => i.item.id)]));
    expect(listForMonthSelection([longo], "2026-08", "2026-08-30")).toEqual([["2026-08-30", [longo]]]);
    for (const [day, dayItems] of listForMonthSelection([longo], "2026-08", null)) {
      expect(byDate.get(day)).toEqual(dayItems.map((i) => i.id));
    }
    expect(byDate.get("2026-08-30")).toEqual(["longo"]);
  });

  it("período de anos só é projetado nos dias visíveis; fim no meio da grade é respeitado", () => {
    const anos = item({ id: "anos", eventDate: "1900-01-01", eventEndDate: "2100-12-31" });
    const termina = item({ id: "termina", eventDate: "2020-01-01", eventEndDate: "2026-08-15" });
    const comeca = item({ id: "comeca", eventDate: "2026-08-20", eventEndDate: "2030-12-31" });
    const grid = buildMonthGrid({ month: "2026-08", items: [anos, termina, comeca], today: "2026-08-01" });
    const cells = allCells("2026-08");
    expect(cellsWith(grid, "anos")).toEqual(cells);
    expect(cellsWith(grid, "termina")).toEqual(cells.filter((d) => d <= "2026-08-15"));
    expect(cellsWith(grid, "comeca")).toEqual(cells.filter((d) => d >= "2026-08-20"));
    expect(grid.weeks.flat().every((c) => new Set(c.items.map((i) => i.item.id)).size === c.items.length)).toBe(true);
    const again = buildMonthGrid({ month: "2026-08", items: [comeca, anos, termina], today: "2026-08-01" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(grid));
  });

  it("a projeção percorre só a interseção com a janela visível (custo limitado à grade)", () => {
    const { from, to } = monthGridRange("2026-08");
    expect(visibleSpan(item({ id: "anos", eventDate: "1900-01-01", eventEndDate: "2100-12-31" }), from, to)).toEqual({ first: from, last: to });
    expect(visibleSpan(item({ id: "meio", eventDate: "2026-08-10", eventEndDate: "2026-08-12" }), from, to)).toEqual({ first: "2026-08-10", last: "2026-08-12" });
    expect(visibleSpan(item({ id: "um-dia", eventDate: "2026-08-10" }), from, to)).toEqual({ first: "2026-08-10", last: "2026-08-10" });
    expect(visibleSpan(item({ id: "antes", eventDate: "2026-01-01", eventEndDate: "2026-07-25" }), from, to)).toBeNull();
    expect(visibleSpan(item({ id: "depois", eventDate: "2026-09-06", eventEndDate: "2027-01-01" }), from, to)).toBeNull();
    expect(visibleSpan(item({ id: "invalida", eventDate: "" }), from, to)).toBeNull();
    // Mesmo com um período de séculos, só os dias da janela recebem o item.
    const dias = groupItemsByDay([item({ id: "anos", eventDate: "0001-01-01", eventEndDate: "9999-12-31" })], from, to);
    expect(dias).toHaveLength(42);
    expect(dias[0][0]).toBe(from);
    expect(dias[41][0]).toBe(to);
  });
});
