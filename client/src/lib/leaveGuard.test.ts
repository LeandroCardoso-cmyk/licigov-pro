/**
 * Pós-homologação (Frente A) — perda silenciosa de edição não salva pelo MENU LATERAL e por parâmetros do Edital não gravados.
 *
 * Reprodução (antes da correção): o menu lateral chamava `setLocation` direto (sem consultar a etapa aberta) e o Edital só
 * informava o editor de texto — modalidade/forma/plataforma/objeto/critério escolhidos e não gravados sumiam sem aviso.
 * Prova (puro + varredura de fonte, padrão do projeto sem testing-library):
 *  - menu lateral/Sair com e sem edição pendente; cancelar = permanecer; uma única confirmação;
 *  - salvar ⇒ sem aviso; hidratação inicial ⇒ sem falso positivo; recarregar/fechar segue protegido;
 *  - a guarda não grava, não aprova e não descarta nada (rascunho/contrato preservados).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { confirmPendingLeave, installLeaveProtection, pendingLeaveMessage, registerLeaveGuard, type LeaveWindow } from "./leaveGuard";
import { unsavedLeaveMessage } from "./documentJourney";
import { editalUnsavedParameters } from "@/components/procurement/regenerationGuard";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const register = (fn: () => string | null) => { cleanups.push(registerLeaveGuard(fn)); };

/** Simula o clique no menu lateral (mesma decisão do DashboardLayout). */
function clickSidebar(current: string, target: string, confirm: (m: string) => boolean, navigate: (p: string) => void) {
  if (target !== current && !confirmPendingLeave(confirm)) return;
  navigate(target);
}

describe("menu lateral / Sair — guarda do shell", () => {
  it("sem edição pendente: navega sem perguntar", () => {
    const confirm = vi.fn(() => true);
    const navigate = vi.fn();
    clickSidebar("/processos", "/contratos", confirm, navigate);
    expect(confirm).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/contratos");
  });

  it("com edição pendente: pergunta com a mensagem da etapa; cancelar mantém a tela (não navega)", () => {
    register(() => unsavedLeaveMessage("etp"));
    const navigate = vi.fn();
    const confirm = vi.fn(() => false);
    clickSidebar("/processos", "/gestao", confirm, navigate);
    expect(confirm).toHaveBeenCalledWith(unsavedLeaveMessage("etp"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("com edição pendente: sair conscientemente navega", () => {
    register(() => unsavedLeaveMessage("edital"));
    const navigate = vi.fn();
    clickSidebar("/processos", "/gestao", () => true, navigate);
    expect(navigate).toHaveBeenCalledWith("/gestao");
  });

  it("clicar no item da própria tela não pergunta (a tela não é desmontada, nada se perde)", () => {
    register(() => unsavedLeaveMessage("tr"));
    const confirm = vi.fn(() => false);
    const navigate = vi.fn();
    clickSidebar("/processos", "/processos", confirm, navigate);
    expect(confirm).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
  });

  it("várias guardas pendentes ⇒ UMA única confirmação (sem aviso duplicado)", () => {
    register(() => null);
    register(() => unsavedLeaveMessage("dfd"));
    register(() => unsavedLeaveMessage("tr"));
    const confirm = vi.fn(() => true);
    expect(confirmPendingLeave(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(unsavedLeaveMessage("dfd"));
  });

  it("após salvar (guarda removida/sem mensagem) não há aviso", () => {
    let dirty = true;
    register(() => (dirty ? unsavedLeaveMessage("etp") : null));
    expect(pendingLeaveMessage()).not.toBeNull();
    dirty = false; // salvou
    const confirm = vi.fn(() => false);
    expect(confirmPendingLeave(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    const unregister = registerLeaveGuard(() => "x");
    unregister();
    expect(pendingLeaveMessage()).toBeNull();
  });
});

/** Histórico + eventos mínimos do navegador (sem DOM): suficiente para o contrato de Voltar e recarregar/fechar. */
function fakeWindow(entries: unknown[] = [null]) {
  const stack = [...entries];
  let index = stack.length - 1;
  const listeners: Record<string, Array<(e: Event) => void>> = { popstate: [], beforeunload: [] };
  const fire = (type: string, e = new Event(type)) => { for (const l of [...listeners[type]]) l(e); return e; };
  const win = {
    history: {
      get state() { return stack[index]; },
      pushState(data: unknown) { stack.splice(index + 1); stack.push(data); index = stack.length - 1; },
      back() { if (index > 0) { index--; fire("popstate"); } },
      forward() { if (index < stack.length - 1) { index++; fire("popstate"); } },
    },
    addEventListener: (t: string, l: (e: Event) => void) => { listeners[t].push(l); },
    removeEventListener: (t: string, l: (e: Event) => void) => { listeners[t] = listeners[t].filter((x) => x !== l); },
  };
  return { win: win as unknown as LeaveWindow, stack, index: () => index, fire, listeners };
}

describe("Voltar do navegador e recarregar/fechar", () => {
  it("Voltar com edição pendente: pergunta UMA vez; cancelar permanece na tela (entrada atual preservada)", () => {
    register(() => unsavedLeaveMessage("edital"));
    const f = fakeWindow(["anterior"]);
    const confirm = vi.fn(() => false);
    cleanups.push(installLeaveProtection(f.win, confirm));
    expect(f.stack).toHaveLength(2); // sentinela
    f.win.history.back();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.index()).toBe(1); // voltou à sentinela: a tela fica
  });

  it("Voltar com edição pendente: confirmar sai de verdade, sem novo aviso de recarregar/fechar", () => {
    register(() => unsavedLeaveMessage("tr"));
    const f = fakeWindow(["pagina-anterior", "processos"]);
    const confirm = vi.fn(() => true);
    cleanups.push(installLeaveProtection(f.win, confirm));
    f.win.history.back();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.index()).toBe(0); // chegou à página anterior
    expect(f.fire("beforeunload").defaultPrevented).toBe(false);
  });

  it("recarregar/fechar com edição pendente ⇒ o navegador pede confirmação; após salvar ⇒ não pede", () => {
    let dirty = true;
    register(() => (dirty ? unsavedLeaveMessage("dfd") : null));
    const f = fakeWindow();
    cleanups.push(installLeaveProtection(f.win, () => true));
    const ev = new Event("beforeunload", { cancelable: true });
    f.fire("beforeunload", ev);
    expect(ev.defaultPrevented).toBe(true);
    dirty = false;
    const ev2 = new Event("beforeunload", { cancelable: true });
    f.fire("beforeunload", ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });

  it("reinstalar (troca de etapa com edição) não empilha outra sentinela; desinstalar remove os ouvintes", () => {
    const f = fakeWindow();
    const u1 = installLeaveProtection(f.win, () => true);
    u1();
    const u2 = installLeaveProtection(f.win, () => true);
    expect(f.stack).toHaveLength(2);
    u2();
    expect(f.listeners.popstate).toHaveLength(0);
    expect(f.listeners.beforeunload).toHaveLength(0);
  });
});

describe("Edital — parâmetros escolhidos e ainda não gravados", () => {
  type M = "pregao" | "concorrencia"; type F = "eletronico" | "presencial"; type P = "bll" | "comprasgov";
  const none = { modality: null, form: null, platform: null };
  const saved = { modality: "pregao" as M, form: "eletronico" as F, platform: "bll" as P };
  const base = {
    effective: saved, proposed: none, baseline: saved,
    proposedText: { judgmentCriterion: null, executionRegime: null },
    persistedText: { judgmentCriterion: "menor preço", executionRegime: null },
    textEditable: true, objectEdited: false, object: "Objeto X", objectBaseline: "Objeto X",
  } as Parameters<typeof editalUnsavedParameters<M, F, P>>[0];
  const unsaved = (over: Partial<typeof base>) => editalUnsavedParameters<M, F, P>({ ...base, ...over });

  it("carga inicial / hidratação (sem escolha da pessoa) ⇒ sem falso positivo", () => {
    expect(unsaved({})).toBe(false);
    expect(unsaved({ baseline: null, effective: none })).toBe(false); // processo sem parâmetros
    expect(unsaved({ object: "", objectBaseline: "Objeto X" })).toBe(false); // objeto ainda hidratando
  });

  it("modalidade/forma/plataforma trocadas e não confirmadas ⇒ pendente", () => {
    expect(unsaved({ proposed: { ...none, modality: "concorrencia" }, effective: { ...saved, modality: "concorrencia" } })).toBe(true);
    expect(unsaved({ proposed: { ...none, platform: "comprasgov" }, effective: { ...saved, platform: "comprasgov" } })).toBe(true);
  });

  it("escolha antes da 1ª geração: pendente até o escopo ser registrado; registrado ⇒ sem aviso", () => {
    expect(unsaved({ baseline: null, proposed: { ...none, modality: "pregao" }, effective: { ...none, modality: "pregao" } })).toBe(true);
    expect(unsaved({ baseline: saved, proposed: saved, effective: saved })).toBe(false);
  });

  it("voltar ao valor gravado ⇒ sem aviso; plataforma irrelevante fora do eletrônico", () => {
    expect(unsaved({ proposed: { ...none, modality: "pregao" } })).toBe(false);
    const presencial = { modality: "pregao" as M, form: "presencial" as F, platform: null };
    expect(unsaved({ baseline: { ...presencial, platform: "bll" }, proposed: { ...none, form: "presencial" }, effective: presencial })).toBe(false);
  });

  it("critério/regime digitado (caminho legado) ⇒ pendente; com modelo vinculado (somente leitura) não conta", () => {
    const typed = { proposedText: { judgmentCriterion: null, executionRegime: "empreitada por preço global" } };
    expect(unsaved(typed)).toBe(true);
    expect(unsaved({ ...typed, textEditable: false })).toBe(false);
    expect(unsaved({ proposedText: { judgmentCriterion: "menor preço", executionRegime: "  " } })).toBe(false); // igual/vazio não é envio
  });

  it("objeto editado pela pessoa ⇒ pendente; após gerar com ele (nova base) ⇒ sem aviso", () => {
    expect(unsaved({ objectEdited: true, object: "Objeto Y" })).toBe(true);
    expect(unsaved({ objectEdited: true, object: "Objeto Y", objectBaseline: "Objeto Y" })).toBe(false);
    expect(unsaved({ objectEdited: true, object: " Objeto X " })).toBe(false);
  });
});

describe("fiação (fonte)", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
  const layout = read("client/src/components/DashboardLayout.tsx");
  const shell = read("client/src/pages/ProcessoLicitatorio.tsx");
  const edital = read("client/src/components/procurement/EditalWorkspace.tsx");
  const guard = read("client/src/lib/leaveGuard.ts");

  it("menu lateral e Sair consultam a guarda antes de sair; nenhuma navegação direta sobra", () => {
    expect(layout).toContain("if (item.path !== location && !confirmPendingLeave()) return; setLocation(item.path);");
    expect(layout).toContain("onClick={() => { if (confirmPendingLeave()) logout(); }}");
    expect(layout).not.toMatch(/onClick=\{\(\) => setLocation\(/);
    expect(layout).not.toMatch(/onClick=\{logout\}/);
  });

  it("o processo registra a guarda com a mesma mensagem da troca de etapa; recarregar/fechar segue protegido", () => {
    expect(shell).toContain("useLeaveGuard(stageDirty && journeyKind ? unsavedLeaveMessage(journeyKind) : null);");
    expect(shell).not.toMatch(/addEventListener\("beforeunload"/); // centralizado no hook (sem aviso duplicado)
    expect(guard).toContain("installLeaveProtection(window, (m) => window.confirm(m))");
    expect(shell).toContain("onClick={() => navigateTab(tab.key)}");
    expect(shell).toMatch(/onClick: leaveToList/);
  });

  it("o Edital informa editor OU parâmetros não gravados (e não só o editor)", () => {
    expect(edital).toContain("onDirtyChange?.(editorDirty || paramsUnsaved)");
    expect(edital).not.toContain("onDirtyChange?.(editorDirty); }");
    expect(edital).toContain("setObjectEdited(true); setObject(e.target.value);");
    // geração concluída pelo acompanhamento (resposta perdida) também atualiza a base do objeto (sem falso positivo permanente)
    expect(edital).toContain("if (objectSent.current !== null) setObjectUsed(objectSent.current);");
  });

  it("a guarda só decide a navegação: sem autosave, sem mutação, sem confirmação jurídica fictícia", () => {
    const code = guard.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/trpc|mutate|fetch\(|localStorage|sessionStorage/);
    expect(code).not.toMatch(/aprova|homolog|assin/i);
  });
});
