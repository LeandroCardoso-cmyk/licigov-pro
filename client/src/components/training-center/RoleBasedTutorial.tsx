import React, { useState } from "react";

type Role = "elaborador" | "revisor" | "aprovador" | "gestor" | "admin";

interface TutorialStep {
  title:       string;
  description: string;
  action?:     string;
  isSimulation: boolean;
}

interface RoleTutorial {
  role:     Role;
  title:    string;
  steps:    TutorialStep[];
  duration: number; // minutes
}

const ROLE_TUTORIALS: Record<Role, RoleTutorial> = {
  elaborador: {
    role: "elaborador", title: "Tutorial: Elaborador de TR", duration: 20,
    steps: [
      { title: "Criar Processo", description: "Acesse Processos > Novo e preencha os dados básicos do processo de contratação.", action: "Ir para Processos", isSimulation: false },
      { title: "Adicionar Itens TR", description: "Utilize a pesquisa semântica para encontrar itens do CATMAT correspondentes.", action: "Simular pesquisa", isSimulation: true },
      { title: "Revisar Candidatos", description: "Analise os candidatos sugeridos pelo motor semântico e selecione o mais adequado.", action: "Simular revisão", isSimulation: true },
      { title: "Encaminhar para Revisão", description: "Após completar todos os itens, encaminhe o TR para revisão técnica.", action: "Avançar workflow", isSimulation: false },
    ],
  },
  revisor: {
    role: "revisor", title: "Tutorial: Revisor Técnico", duration: 15,
    steps: [
      { title: "Fila de Revisão", description: "Acesse sua fila de revisão e selecione o processo mais prioritário.", isSimulation: false },
      { title: "Revisar Itens", description: "Para cada item, verifique se a especificação está adequada conforme o edital.", isSimulation: false },
      { title: "Aprovar ou Devolver", description: "Aprove o item se adequado ou devolva para correção com justificativa.", action: "Simular aprovação", isSimulation: true },
    ],
  },
  aprovador: {
    role: "aprovador", title: "Tutorial: Aprovador", duration: 10,
    steps: [
      { title: "Notificações", description: "Você receberá notificações quando um processo estiver aguardando sua aprovação.", isSimulation: false },
      { title: "Verificar Conformidade", description: "Verifique se o TR está em conformidade com as exigências legais (Lei 14.133/2021).", isSimulation: false },
      { title: "Aprovar", description: "Após verificação, assine eletronicamente aprovando o prosseguimento.", action: "Simular assinatura", isSimulation: true },
    ],
  },
  gestor: {
    role: "gestor", title: "Tutorial: Gestor Municipal", duration: 12,
    steps: [
      { title: "Dashboard Executivo", description: "Acompanhe o andamento de todos os processos da sua secretaria.", isSimulation: false },
      { title: "Indicadores", description: "Monitore prazos, valores e conformidade em tempo real.", isSimulation: false },
      { title: "Relatórios", description: "Gere relatórios gerenciais e exporte para formatos institucionais.", action: "Simular exportação", isSimulation: true },
    ],
  },
  admin: {
    role: "admin", title: "Tutorial: Administrador do Sistema", duration: 25,
    steps: [
      { title: "Configurar Organização", description: "Configure os parâmetros institucionais: departamentos, usuários e permissões.", isSimulation: false },
      { title: "Templates Operacionais", description: "Selecione e customize os templates adequados para sua prefeitura.", isSimulation: false },
      { title: "Gerenciar Ambientes", description: "Configure os ambientes de desenvolvimento, homologação e produção.", isSimulation: false },
      { title: "Monitoramento", description: "Acompanhe saúde do sistema, cargas de trabalho e métricas de uso.", isSimulation: false },
    ],
  },
};

interface Props {
  defaultRole?: Role;
  onComplete?:  (role: Role, score: number) => void;
}

export function RoleBasedTutorial({ defaultRole = "elaborador", onComplete }: Props) {
  const [role,      setRole]      = useState<Role>(defaultRole);
  const [stepIdx,   setStepIdx]   = useState(0);
  const [completed, setCompleted] = useState(false);

  const tutorial = ROLE_TUTORIALS[role];
  const step     = tutorial.steps[stepIdx];
  const progress = Math.round((stepIdx / tutorial.steps.length) * 100);

  function next() {
    if (stepIdx < tutorial.steps.length - 1) {
      setStepIdx(s => s + 1);
    } else {
      setCompleted(true);
      onComplete?.(role, 100);
    }
  }

  function restart() {
    setStepIdx(0);
    setCompleted(false);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 600 }}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {(Object.keys(ROLE_TUTORIALS) as Role[]).map(r => (
          <button
            key={r}
            onClick={() => { setRole(r); setStepIdx(0); setCompleted(false); }}
            style={{
              padding: "0.3rem 0.75rem", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem",
              background: role === r ? "#2563eb" : "#f3f4f6",
              color:      role === r ? "#fff"    : "#374151",
              border:     "1px solid",
              borderColor: role === r ? "#2563eb" : "#d1d5db",
            }}
          >
            {ROLE_TUTORIALS[r].title.replace("Tutorial: ", "")}
          </button>
        ))}
      </div>

      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>{tutorial.title}</h3>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{tutorial.duration} min</span>
        </div>

        <div style={{ background: "#e5e7eb", borderRadius: 4, height: 6, marginBottom: "1rem" }}>
          <div style={{ background: "#2563eb", height: 6, borderRadius: 4, width: `${progress}%`, transition: "width 0.3s" }} />
        </div>

        {completed ? (
          <div style={{ textAlign: "center", padding: "1rem" }}>
            <div style={{ fontSize: "2rem" }}>🎓</div>
            <h4 style={{ color: "#16a34a" }}>Tutorial Concluído!</h4>
            <button
              onClick={restart}
              style={{ padding: "0.5rem 1rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}
            >
              Repetir Tutorial
            </button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "0.25rem", fontSize: "0.75rem", color: "#6b7280" }}>
              Passo {stepIdx + 1} de {tutorial.steps.length}
              {step.isSimulation && <span style={{ marginLeft: "0.5rem", color: "#7c3aed" }}>🔬 Simulação</span>}
            </div>
            <h4 style={{ marginBottom: "0.5rem" }}>{step.title}</h4>
            <p style={{ color: "#374151", fontSize: "0.875rem", marginBottom: "1rem" }}>{step.description}</p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              {step.action && (
                <button
                  onClick={() => {}}
                  style={{ padding: "0.4rem 0.8rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  {step.action}
                </button>
              )}
              <button
                onClick={next}
                style={{ padding: "0.4rem 1rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}
              >
                {stepIdx === tutorial.steps.length - 1 ? "Concluir" : "Próximo →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
