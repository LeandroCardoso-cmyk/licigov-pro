/**
 * R9 / SEM-071 — Gestão do Departamento: UMA definição de "Atrasada", UMA faixa de cor de prazo, exportações
 * que chamam procedures reais e responsável validado no servidor.
 *
 * Unitário (sem banco): regra pura compartilhada (shared/taskDeadline.ts), consumidores do servidor
 * (Excel/PDF) e recusa do responsável inválido nos dois routers SEM nenhuma escrita. A paridade do espelho
 * SQL e a validação contra `organization_members` real ficam no smoke MySQL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

vi.mock("../../db");
vi.mock("../../db/organizations");
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import * as db from "../../db";
import * as orgDb from "../../db/organizations";
import {
  countOverdueTasks, isTaskOverdue, taskDeadlineBucket, TASK_DEADLINE_BUCKET_LABELS,
} from "@shared/taskDeadline";
import { generateTasksExcelReport, generateTasksPDFContent, summarizeTasksForReport } from "../../services/taskReports";
import { TASK_ASSIGNEE_NOT_MEMBER_MESSAGE } from "../../services/taskAssigneePolicy";
import { departmentTasksRouter } from "../../routers/departmentTasksRouter";
import { taskRouter } from "../../routers/taskRouter";
import { makeContext, mockUser } from "../helpers/fixtures";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
type ActiveUser = Awaited<ReturnType<typeof orgDb.getActiveOrganizationUserById>>;

describe("R9 / SEM-071 — regra única de 'Atrasada'", () => {
  it("prazo vencido e não encerrada ⇒ atrasada; encerrada nunca; status manual é preservado", () => {
    expect(isTaskOverdue({ status: "pendente", deadline: at(-1) }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: "em_andamento", deadline: at(-0.01).toISOString() }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: "concluida", deadline: at(-5) }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: "cancelada", deadline: at(-5) }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: "atrasada", deadline: at(10) }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: "atrasada", deadline: null }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: "pendente", deadline: null }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: "pendente", deadline: "data-invalida" }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: "pendente", deadline: at(1) }, NOW)).toBe(false);
  });

  it("countOverdueTasks soma pela mesma regra", () => {
    expect(countOverdueTasks([
      { status: "pendente", deadline: at(-1) }, { status: "atrasada", deadline: null },
      { status: "concluida", deadline: at(-1) }, { status: "cancelada", deadline: at(-1) }, { status: "pendente", deadline: at(2) },
    ], NOW)).toBe(2);
  });
});

describe("R9 / SEM-071 — faixa única de cor do prazo (CLAUDE.md: verde >7d, amarelo 3–7d, laranja 1–3d, vermelho vencido)", () => {
  it.each([
    [-1, "vermelho"], [0.5, "laranja"], [1, "laranja"], [3, "laranja"], [3.01, "amarelo"],
    [7, "amarelo"], [7.01, "verde"], [30, "verde"],
  ] as const)("faltando %s dia(s) ⇒ %s", (days, bucket) => {
    expect(taskDeadlineBucket({ status: "pendente", deadline: at(days) }, NOW)).toBe(bucket);
  });

  it("encerrada sem cor de urgência; sem prazo neutro; manual atrasada vermelho", () => {
    expect(taskDeadlineBucket({ status: "concluida", deadline: at(-3) }, NOW)).toBe("encerrada");
    expect(taskDeadlineBucket({ status: "pendente", deadline: null }, NOW)).toBe("sem_prazo");
    expect(taskDeadlineBucket({ status: "atrasada", deadline: at(20) }, NOW)).toBe("vermelho");
    expect(TASK_DEADLINE_BUCKET_LABELS.vermelho).toBe("Atrasada");
  });
});

function task(id: number, status: string, deadline: Date | null) {
  return {
    id, organizationId: 1, title: `Tarefa ${id}`, description: null, type: "Análise", status, priority: "media",
    assignedTo: 1, deadline, processId: null, tags: null, createdBy: 1, createdAt: at(-10), updatedAt: at(-1),
  };
}
const REPORT_TASKS = [
  task(1, "pendente", at(-2)),     // atrasada pelo prazo (antes: Excel/PDF NÃO contavam)
  task(2, "atrasada", at(15)),     // atrasada manual
  task(3, "concluida", at(-5)),    // encerrada
  task(4, "cancelada", at(-5)),    // encerrada (antes: KPI do servidor contava como atrasada)
  task(5, "em_andamento", at(2)),  // laranja
  task(6, "pendente", at(5)),      // amarelo
];

describe("R9 / SEM-071 — Excel/PDF usam a regra única", () => {
  beforeEach(() => {
    vi.mocked(db.listTasksForOrganization).mockResolvedValue(REPORT_TASKS as unknown as Awaited<ReturnType<typeof db.listTasksForOrganization>>);
  });

  it("resumo conta atrasadas pelo prazo OU status manual, nunca encerradas", () => {
    expect(summarizeTasksForReport(REPORT_TASKS, NOW).overdue).toBe(2);
  });

  it("PDF (Markdown): 'Atrasadas' = 2 e coluna 'Situação do prazo' por faixa", async () => {
    const md = await generateTasksPDFContent(1, undefined, { now: NOW });
    expect(md).toContain("**Atrasadas:** 2");
    expect(md).toContain("| Tarefa 1 | Pendente | Média |");
    expect(md).toMatch(/\| Tarefa 1 \|.*\| Atrasada \|/);
    expect(md).toMatch(/\| Tarefa 5 \|.*\| Vence em até 3 dias \|/);
    expect(md).toMatch(/\| Tarefa 6 \|.*\| Vence em 3 a 7 dias \|/);
    expect(md).toMatch(/\| Tarefa 4 \|.*\| Encerrada \|/);
  });

  it("Excel: linha vermelha para TODA tarefa atrasada (inclusive pelo prazo) e célula de situação colorida", async () => {
    const buffer = await generateTasksExcelReport(1, undefined, { now: NOW });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Tarefas")!;
    const rowOf = (id: number) => {
      for (let i = 2; i <= ws.rowCount; i++) if (ws.getRow(i).getCell(1).value === id) return ws.getRow(i);
      throw new Error(`linha ${id} ausente`);
    };
    const fillOf = (row: ExcelJS.Row, col: number) => {
      const fill = row.getCell(col).fill as ExcelJS.FillPattern | undefined;
      return fill?.fgColor?.argb;
    };
    const situationCol = (ws.getRow(1).values as unknown[]).indexOf("Situação do prazo");
    expect(situationCol).toBeGreaterThan(0);
    expect(fillOf(rowOf(1), 2)).toBe("FFFFE0E0");          // atrasada pelo prazo
    expect(fillOf(rowOf(2), 2)).toBe("FFFFE0E0");          // atrasada manual
    expect(fillOf(rowOf(4), 2)).toBe("FFF0F0F0");          // cancelada: cinza, nunca vermelha
    expect(rowOf(1).getCell(situationCol).value).toBe("Atrasada");
    expect(rowOf(5).getCell(situationCol).value).toBe("Vence em até 3 dias");
    expect(fillOf(rowOf(5), situationCol)).toBe("FFFFE0B2");
  });
});

describe("R9 / SEM-071 — responsável validado no servidor (membro ATIVO do órgão)", () => {
  const caller = () => departmentTasksRouter.createCaller(makeContext(mockUser));
  const tasksCaller = () => taskRouter.createCaller(makeContext(mockUser));
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };

  beforeEach(() => {
    vi.mocked(db.createTask).mockReset().mockResolvedValue(77);
    vi.mocked(db.updateTaskForOrganization).mockReset().mockResolvedValue(true);
    vi.mocked(orgDb.getActiveOrganizationUserById).mockReset();
  });

  it("departmentTasks.create: não-membro/inativo/outro órgão ⇒ BAD_REQUEST e NENHUMA escrita", async () => {
    vi.mocked(orgDb.getActiveOrganizationUserById).mockResolvedValue(undefined);
    const err = await errOf(() => caller().create({ title: "T", type: "x", deadline: "2026-10-10", assignedTo: 999 }));
    expect(err).toEqual({ code: "BAD_REQUEST", message: TASK_ASSIGNEE_NOT_MEMBER_MESSAGE });
    expect(orgDb.getActiveOrganizationUserById).toHaveBeenCalledWith(999, 1);
    expect(db.createTask).not.toHaveBeenCalled();
  });

  it("departmentTasks.create: membro ativo ⇒ grava com prazo como Date (sem `as any`)", async () => {
    vi.mocked(orgDb.getActiveOrganizationUserById).mockResolvedValue({ id: 5, name: "Membro" } as ActiveUser);
    await caller().create({ title: "T", type: "x", deadline: "2026-10-10T12:00:00.000Z", assignedTo: 5 });
    expect(db.createTask).toHaveBeenCalledWith(expect.objectContaining({
      assignedTo: 5, organizationId: 1, createdBy: mockUser.id, deadline: new Date("2026-10-10T12:00:00.000Z"),
    }));
  });

  it("departmentTasks.create: prazo inválido é recusado antes de qualquer escrita", async () => {
    vi.mocked(orgDb.getActiveOrganizationUserById).mockResolvedValue({ id: 5, name: "Membro" } as ActiveUser);
    const err = await errOf(() => caller().create({ title: "T", type: "x", deadline: "não-é-data", assignedTo: 5 }));
    expect(err.code).toBe("BAD_REQUEST");
    expect(db.createTask).not.toHaveBeenCalled();
  });

  it("departmentTasks.update: troca de responsável inválida ⇒ BAD_REQUEST sem escrita; sem troca não consulta", async () => {
    vi.mocked(orgDb.getActiveOrganizationUserById).mockResolvedValue(undefined);
    const err = await errOf(() => caller().update({ id: 10, assignedTo: 999 }));
    expect(err).toEqual({ code: "BAD_REQUEST", message: TASK_ASSIGNEE_NOT_MEMBER_MESSAGE });
    expect(db.updateTaskForOrganization).not.toHaveBeenCalled();

    await caller().update({ id: 10, status: "concluida" });
    expect(db.updateTaskForOrganization).toHaveBeenCalledWith(10, 1, { status: "concluida" });
    expect(orgDb.getActiveOrganizationUserById).toHaveBeenCalledTimes(1);
  });

  it("tasks.create / tasks.update aplicam a mesma política", async () => {
    vi.mocked(orgDb.getActiveOrganizationUserById).mockResolvedValue(undefined);
    expect(await errOf(() => tasksCaller().create({ title: "T", type: "x", priority: "media", assignedTo: 999 })))
      .toEqual({ code: "BAD_REQUEST", message: TASK_ASSIGNEE_NOT_MEMBER_MESSAGE });
    expect(await errOf(() => tasksCaller().update({ id: 10, assignedTo: 999 })))
      .toEqual({ code: "BAD_REQUEST", message: TASK_ASSIGNEE_NOT_MEMBER_MESSAGE });
    expect(db.createTask).not.toHaveBeenCalled();
    expect(db.updateTaskForOrganization).not.toHaveBeenCalled();
  });
});

describe("R9 / SEM-071 — botões chamam procedures existentes (sem `as any`)", () => {
  const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, "../../..", rel), "utf8");

  it("DepartmentManagement usa trpc.tasks.exportExcel/exportPDF/checkDeadlines tipados", () => {
    const src = read("client/src/pages/DepartmentManagement.tsx");
    expect(src).not.toMatch(/\(trpc as any\)\./);
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toMatch(/departmentTasks\.(exportExcel|exportPDF|checkDeadlines)\.useMutation/);
    expect(src).toContain("trpc.tasks.exportExcel.useMutation");
    expect(src).toContain("trpc.tasks.exportPDF.useMutation");
    expect(src).toContain("trpc.tasks.checkDeadlines.useMutation");
    expect(src).toContain("Resumo (Markdown)");
    expect(src).not.toMatch(/"[^"\n]*opacity-50[^"\n]*"/); // nenhuma classe com opacity-50
    expect(src).toContain("disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground");
    // as procedures existem no router montado em `tasks`
    const router = read("server/routers/taskRouter.ts");
    for (const p of ["exportExcel:", "exportPDF:", "checkDeadlines:"]) expect(router).toContain(p);
    expect(read("server/routers.ts")).toMatch(/tasks:\s*taskRouter/);
  });

  it("KPI, lista, Kanban e calendário consomem a regra compartilhada", () => {
    expect(read("client/src/components/TaskDashboard.tsx")).toContain("countOverdueTasks");
    expect(read("client/src/components/TaskList.tsx")).toContain("taskDeadlineBucket");
    expect(read("client/src/components/task-kanban/TaskCard.tsx")).toContain("taskDeadlineBucket");
    expect(read("client/src/components/TaskCalendar.tsx")).toContain("isTaskOverdue");
    expect(read("client/src/components/TaskList.tsx")).not.toMatch(/alert\(/);
  });
});
