/**
 * Centro de Operações — ciclo de vida do registro e planejamento do backfill de agenda (domínio puro).
 * Dados 100% sintéticos: prefixo de referência fictício, objetos fictícios, datas arbitrárias.
 */
import { describe, it, expect } from "vitest";
import {
  isActiveOperationRecord, lifecycleTimelineSummary, normalizeLifecycle, planLifecycleTransition,
} from "../domain/operationRecordLifecycle";
import {
  canonicalItem, eventTitleFor, parseItemReferences, parseScheduleBackfillDataset, planScheduleBackfill,
  type BackfillRecord, type ScheduleBackfillDataset,
} from "../domain/operationRecordScheduleBackfill";

const P = "Lote.X";
const rec = (id: string, stage: string, over: Partial<BackfillRecord> = {}): BackfillRecord => ({
  id, number: "", object: `Objeto ${id}`, currentStage: stage, eventDate: "", eventEndDate: "", eventTime: "", ...over,
});

describe("ciclo de vida operacional", () => {
  it("valores legados/vazios são ativos; transições e no-ops idempotentes", () => {
    expect(normalizeLifecycle("")).toBe("active");
    expect(normalizeLifecycle(null)).toBe("active");
    expect(isActiveOperationRecord({ lifecycleStatus: "completed" })).toBe(false);
    expect(planLifecycleTransition("active", "complete")).toEqual({ kind: "transition", from: "active", to: "completed" });
    expect(planLifecycleTransition("completed", "complete")).toEqual({ kind: "noop", state: "completed" });
    expect(planLifecycleTransition("completed", "reopen")).toEqual({ kind: "transition", from: "completed", to: "active" });
    expect(planLifecycleTransition("active", "reopen")).toEqual({ kind: "noop", state: "active" });
  });

  it("resumo da timeline registra estado anterior e posterior (e motivo, quando houver)", () => {
    expect(lifecycleTimelineSummary("active", "completed", "")).toBe("Registro operacional concluído (estado ativo → concluído).");
    expect(lifecycleTimelineSummary("completed", "active", "engano")).toContain("reaberto (estado concluído → ativo). Motivo: engano");
  });
});

describe("referências de item (token exato)", () => {
  it("lê item único, pares consolidados e separadores; item 4 nunca casa item 45", () => {
    expect([...parseItemReferences("Finalizado · Lote.X item 45", P).items]).toEqual(["45"]);
    expect([...parseItemReferences("Certame · Lote.X itens 7/8", P).items]).toEqual(["7", "8"]);
    expect([...parseItemReferences("lote.x ITENS 3, 4 e 5", P).items]).toEqual(["3", "4", "5"]);
    expect(parseItemReferences("Outro.Y item 4", P).items.size).toBe(0);
    expect(parseItemReferences("sem referência", P).items.size).toBe(0);
    expect(canonicalItem("007")).toBe("7");
    expect(canonicalItem("abc")).toBeNull();
  });
});

describe("planejamento do backfill", () => {
  const records = [
    rec("r1", "Em andamento · Lote.X item 1"),
    rec("r2", "Finalizado · Lote.X item 2", { eventDate: "2026-01-10" }),
    rec("r3", "Lote.X item 3", { eventDate: "2026-01-05" }),
    rec("r78", "Certame · Lote.X itens 7/8"),
    rec("r9a", "Lote.X item 9"), rec("r9b", "Lote.X item 9"),
    rec("r4", "Lote.X item 4"), rec("r45", "Lote.X item 45"),
    rec("r6", "Lote.X item 6"), // sem data no dataset: permanece sem data
  ];
  const dataset: ScheduleBackfillDataset = {
    referencePrefix: P, expected: 8,
    schedules: [
      { item: 1, eventDate: "2026-02-01" },   // MATCH
      { item: 2, eventDate: "2026-01-10" },   // ALREADY_CORRECT
      { item: 3, eventDate: "2026-02-03" },   // CONFLICT (agenda existente diferente)
      { item: 7, eventDate: "2026-02-07" },   // MATCH (par consolidado resolve para um único registro)
      { item: 9, eventDate: "2026-02-09" },   // AMBIGUOUS
      { item: 10, eventDate: "2026-02-10" },  // NOT_FOUND (nunca cria)
      { item: 4, eventDate: "2026-02-04" },   // MATCH (não confunde com 45)
      { item: 45, eventDate: "2026-02-15" },  // MATCH
    ],
  };

  it("classifica MATCH / ALREADY_CORRECT / CONFLICT / NOT_FOUND / AMBIGUOUS sem nunca planejar criação", () => {
    const plan = planScheduleBackfill(dataset, records);
    const by = Object.fromEntries(plan.schedules.map((r) => [r.item, r]));
    expect(by["1"]).toMatchObject({ status: "MATCH", recordId: "r1", action: "update", currentSchedule: "sem data", desiredSchedule: "2026-02-01 · dia inteiro" });
    expect(by["2"]).toMatchObject({ status: "ALREADY_CORRECT", action: "skip" });
    expect(by["3"]).toMatchObject({ status: "CONFLICT", reason: "EXISTING_SCHEDULE_DIFFERS", action: "blocked" });
    expect(by["7"]).toMatchObject({ status: "MATCH", recordId: "r78" });
    expect(by["9"]).toMatchObject({ status: "AMBIGUOUS", recordId: null, action: "blocked" });
    expect(by["10"]).toMatchObject({ status: "NOT_FOUND", recordId: null, action: "blocked" });
    expect(by["4"].recordId).toBe("r4");
    expect(by["45"].recordId).toBe("r45");
    expect(plan.scheduleSummary).toEqual({ expected: 8, MATCH: 4, ALREADY_CORRECT: 1, CONFLICT: 1, NOT_FOUND: 1, AMBIGUOUS: 1 });
    expect(plan.canApply).toBe(false);
    expect(plan.schedules.every((r) => r.action !== ("create" as string))).toBe(true);
    // registro fora do dataset (sem data) não é tocado
    expect(plan.schedules.some((r) => r.recordId === "r6")).toBe(false);
  });

  it("gate só abre com zero bloqueios e MATCH + ALREADY_CORRECT = esperado", () => {
    const ok = planScheduleBackfill({ referencePrefix: P, expected: 2, schedules: [{ item: 1, eventDate: "2026-02-01" }, { item: 2, eventDate: "2026-01-10" }] }, records);
    expect(ok.canApply).toBe(true);
    const wrongCount = planScheduleBackfill({ referencePrefix: P, expected: 3, schedules: [{ item: 1, eventDate: "2026-02-01" }, { item: 2, eventDate: "2026-01-10" }] }, records);
    expect(wrongCount.canApply).toBe(false);
  });

  it("replay: após aplicar, tudo vira ALREADY_CORRECT", () => {
    const applied = records.map((r) => (r.id === "r1" ? { ...r, eventDate: "2026-02-01" } : r));
    const plan = planScheduleBackfill({ referencePrefix: P, expected: 1, schedules: [{ item: 1, eventDate: "2026-02-01" }] }, applied);
    expect(plan.scheduleSummary).toMatchObject({ MATCH: 0, ALREADY_CORRECT: 1 });
  });

  it("entrada duplicada, dois itens do mesmo registro, objeto divergente e data inválida ⇒ CONFLICT", () => {
    const plan = planScheduleBackfill({ referencePrefix: P, schedules: [
      { item: 1, eventDate: "2026-02-01" }, { item: 1, eventDate: "2026-02-02" },
      { item: 7, eventDate: "2026-02-07" }, { item: 8, eventDate: "2026-02-07" },
      { item: 4, eventDate: "2026-02-04", expectedObject: "Outro objeto" },
      { item: 45, eventDate: "2026-02-30" },
    ] }, records);
    expect(plan.schedules.map((r) => r.reason)).toEqual([
      "DUPLICATE_ENTRY", "DUPLICATE_ENTRY", "RECORD_TARGETED_BY_MULTIPLE_ENTRIES", "RECORD_TARGETED_BY_MULTIPLE_ENTRIES", "OBJECT_MISMATCH", "INVALID_DATE",
    ]);
    expect(plan.scheduleSummary.CONFLICT).toBe(6);
  });

  it("conferência do objeto normalizada (caixa/acentos) aceita o mesmo objeto", () => {
    const plan = planScheduleBackfill({ referencePrefix: P, schedules: [{ item: 4, eventDate: "2026-02-04", expectedObject: "  OBJETO  r4 " }] }, records);
    expect(plan.schedules[0].status).toBe("MATCH");
  });
});

describe("eventos vinculados (certame) sem duplicação", () => {
  const records = [rec("r78", "Lote.X itens 7/8", { object: "Aquisição fictícia" }), rec("r1", "Lote.X item 1")];
  const entry = { item: 7, eventType: "certame" as const, number: "99/2026", eventDate: "2026-10-20", eventTime: "09:30" };
  const title = eventTitleFor(entry, records[0]);

  it("sem evento equivalente ⇒ MATCH; evento igual já existente ⇒ ALREADY_CORRECT", () => {
    const d: ScheduleBackfillDataset = { referencePrefix: P, schedules: [], events: [entry] };
    expect(planScheduleBackfill(d, records).events[0]).toMatchObject({ status: "MATCH", recordId: "r78", title: "Certame 99/2026 — Aquisição fictícia", action: "create" });
    const existing = [{ id: "e1", eventType: "certame", title, eventDate: "2026-10-20", eventTime: "09:30", referenceId: "r78" }];
    expect(planScheduleBackfill(d, records, existing).events[0]).toMatchObject({ status: "ALREADY_CORRECT", action: "skip" });
  });

  it("mesmo tipo/data com horário diferente, ou mesmo número em outra data ⇒ CONFLICT; item inexistente ⇒ NOT_FOUND", () => {
    const d: ScheduleBackfillDataset = { referencePrefix: P, schedules: [], events: [entry, { ...entry, item: 50 }] };
    const otherTime = [{ id: "e1", eventType: "certame", title, eventDate: "2026-10-20", eventTime: "14:00", referenceId: "r78" }];
    expect(planScheduleBackfill(d, records, otherTime).events.map((e) => e.status)).toEqual(["CONFLICT", "NOT_FOUND"]);
    const otherDate = [{ id: "e2", eventType: "certame", title, eventDate: "2026-10-01", eventTime: "09:30", referenceId: "r78" }];
    expect(planScheduleBackfill(d, records, otherDate).events[0]).toMatchObject({ status: "CONFLICT", reason: "SAME_NUMBER_ON_OTHER_DATE" });
  });
});

describe("validação estrutural do dataset externo", () => {
  it("rejeita formatos inválidos e aceita o formato documentado", () => {
    expect(() => parseScheduleBackfillDataset([])).toThrow();
    expect(() => parseScheduleBackfillDataset({ schedules: [] })).toThrow(/referencePrefix/);
    expect(() => parseScheduleBackfillDataset({ referencePrefix: P, schedules: [{ item: 1 }] })).toThrow();
    expect(() => parseScheduleBackfillDataset({ referencePrefix: P, schedules: [], events: [{ item: 1, eventType: "outro", number: "1", eventDate: "2026-01-01" }] })).toThrow();
    const d = parseScheduleBackfillDataset({ referencePrefix: P, expected: 1, schedules: [{ item: "1", eventDate: "2026-01-01" }], events: [{ item: 1, eventType: "certame", number: "1/2026", eventDate: "2026-01-02", eventTime: "09:30" }] });
    expect(d).toMatchObject({ referencePrefix: P, expected: 1, schedules: [{ item: "1", eventDate: "2026-01-01" }] });
  });
});
