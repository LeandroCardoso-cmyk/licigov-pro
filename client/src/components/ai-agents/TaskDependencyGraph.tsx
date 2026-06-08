import React from "react";

interface Task { id: string; taskName: string; dependsOn: string[]; }
interface Props { tasks?: Task[]; }

export function TaskDependencyGraph({ tasks = [] }: Props) {
  return (
    <div>
      <h4>Grafo de Dependências</h4>
      {tasks.length === 0 && <p>Sem tarefas.</p>}
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr><th>Tarefa</th><th>Depende de</th></tr></thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id}>
              <td>{t.taskName}</td>
              <td>{t.dependsOn.length === 0 ? "—" : t.dependsOn.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
