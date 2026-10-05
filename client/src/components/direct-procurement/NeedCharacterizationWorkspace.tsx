import React from "react";

/**
 * NeedCharacterizationWorkspace — SEM registro persistido (R9 / SEM-042).
 *
 * A Contratação Direta não possui repositório da caracterização da necessidade (nem tabela, nem migration neste
 * ciclo). O formulário anterior chamava `characterizeNeed`, que só devolvia o objeto em memória e a tela mostrava
 * "Necessidade registrada." — sucesso falso: o texto e o valor estimado se perdiam. Por isso o formulário foi retirado
 * (a procedure recusa de forma estável, sem gravar nada). A necessidade institucional é registrada — e persistida, com
 * aceite humano — na Justificativa da Contratação.
 */

export interface NeedCharacterizationWorkspaceProps {
  workspaceId: string;
}

export default function NeedCharacterizationWorkspace(_props: NeedCharacterizationWorkspaceProps) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Caracterização da Necessidade</h3>
      <p className="text-xs text-muted-foreground">
        Esta etapa ainda não possui registro próprio persistido, por isso não há campo para salvar aqui (nada seria gravado).
        Registre a necessidade, a motivação e o fundamento na <span className="font-medium text-foreground">Justificativa da Contratação</span>,
        que é persistida com o seu aceite.
      </p>
    </div>
  );
}
