import React, { useState } from "react";

type ActionType = "create" | "read" | "update" | "delete" | "approve" | "reject" | "export" | "assign" | "escalate";
type ResourceType = "processo" | "item_tr" | "template" | "relatorio" | "configuracao" | "usuario" | "auditoria";
type PermissionScope = "own" | "department" | "organization" | "global";

interface DepartmentPermission {
  id:         string;
  department: string;
  resource:   ResourceType;
  actions:    ActionType[];
  scope:      PermissionScope;
  active:     boolean;
  grantedAt:  string;
}

interface Props {
  permissions: DepartmentPermission[];
  onGrant?:    (dept: string, resource: ResourceType, actions: ActionType[]) => void;
  onRevoke?:   (permId: string) => void;
}

const ACTION_LABELS: Record<ActionType, string> = {
  create:   "Criar", read: "Ler", update: "Editar", delete: "Excluir",
  approve:  "Aprovar", reject: "Rejeitar", export: "Exportar",
  assign:   "Atribuir", escalate: "Escalar",
};

export function PermissionManager({ permissions, onGrant, onRevoke }: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0 }}>Permissões por Departamento</h3>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ padding: "0.4rem 0.8rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.875rem" }}
        >
          + Nova Permissão
        </button>
      </div>

      {permissions.length === 0 && <p style={{ color: "#9ca3af" }}>Nenhuma permissão configurada.</p>}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th style={{ padding: "0.5rem", textAlign: "left" }}>Departamento</th>
            <th style={{ padding: "0.5rem", textAlign: "left" }}>Recurso</th>
            <th style={{ padding: "0.5rem", textAlign: "left" }}>Ações</th>
            <th style={{ padding: "0.5rem", textAlign: "left" }}>Escopo</th>
            <th style={{ padding: "0.5rem" }}></th>
          </tr>
        </thead>
        <tbody>
          {permissions.map(p => (
            <tr key={p.id} style={{ borderBottom: "1px solid #e5e7eb", opacity: p.active ? 1 : 0.5 }}>
              <td style={{ padding: "0.5rem" }}>{p.department}</td>
              <td style={{ padding: "0.5rem" }}>{p.resource}</td>
              <td style={{ padding: "0.5rem" }}>{p.actions.map(a => ACTION_LABELS[a]).join(", ")}</td>
              <td style={{ padding: "0.5rem" }}>{p.scope}</td>
              <td style={{ padding: "0.5rem" }}>
                {p.active && (
                  <button
                    onClick={() => onRevoke?.(p.id)}
                    style={{ padding: "0.2rem 0.5rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, cursor: "pointer", color: "#dc2626", fontSize: "0.75rem" }}
                  >
                    Revogar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
