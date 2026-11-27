/**
 * PROMPT 08 — consumidores de frontend dos achados D-1, D-2 e D-3 (contratos de UI sobre o código-fonte efetivo).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D-1 — botões Nova Tarefa", () => {
  it("cabeçalho abre o diálogo único (operator+) e as chamadas apontam para procedures existentes", () => {
    const page = read("client/src/pages/DepartmentManagement.tsx");
    expect(page).toMatch(/onClick=\{\(\) => setCreateOpen\(true\)\}/);
    expect(page).toContain("<CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />");
    expect(page).not.toContain("(trpc as any).departmentTasks");
    expect(page).toContain('hasRole("operator")');
  });
  it("coluna do Kanban cria no status da coluna; sem callback (viewer) não há botão", () => {
    const col = read("client/src/components/task-kanban/KanbanColumn.tsx");
    expect(col).toMatch(/onClick=\{\(\) => onCreateTask\(column\.id\)\}/);
    expect(col).toMatch(/\{onCreateTask && \(/);
    expect(read("client/src/components/TaskKanban.tsx")).toContain("onCreateTask={canEdit ? setCreateStatus : undefined}");
  });
  it("diálogo envia prazo como data local opcional e invalida a listagem", () => {
    const dlg = read("client/src/components/task-kanban/CreateTaskDialog.tsx");
    expect(dlg).toContain("trpc.departmentTasks.create.useMutation");
    expect(dlg).toContain("deadline: deadline || null");
    expect(dlg).toContain("utils.departmentTasks.list.invalidate()");
  });
});

describe("D-3 — anexos sem URL pública", () => {
  it("download pede URL assinada; nenhum href direto para fileUrl", () => {
    const att = read("client/src/components/task-detail/TaskAttachments.tsx");
    expect(att).not.toContain("a.fileUrl");
    expect(att).toContain("onClick={() => onDownload(a.id)}");
    expect(read("client/src/components/TaskDetailModal.tsx")).toContain("utils.departmentTasks.getAttachmentDownloadUrl.fetch");
  });
});

describe("D-2 — aditivo sem efeito antecipado", () => {
  it("Contract Workspace: criação não promete reagendamento; formalização explícita", () => {
    const ws = read("client/src/components/contract-workspace/AddendumWorkspace.tsx");
    expect(ws).not.toMatch(/são reagendados e a data entra no termo/);
    expect(ws).toContain("só são reagendados quando o aditivo for formalizado");
    expect(ws).toContain("trpc.contractWorkspace.formalizeAddendum.useMutation");
    expect(ws).toContain('Registrar formalização');
  });
  it("registro legado exige data de assinatura do termo", () => {
    expect(read("client/src/components/NewAmendmentModal.tsx")).toMatch(/signedAt: new Date\(`\$\{signedAt\}T12:00:00`\)/);
  });
});
