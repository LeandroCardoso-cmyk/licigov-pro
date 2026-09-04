import React from "react";
import ContractOverview from "./ContractOverview";
import NewContractWizard from "./NewContractWizard";
import ImportedContracts from "./ImportedContracts";
import ContractWorkspace from "./ContractWorkspace";

/**
 * ContractsHome — REAL (tRPC via filhos).
 *
 * Página raiz do Business Domain Contratos. Foco EXCLUSIVO em engenharia documental
 * contratual (não ERP). Permite: gerar contratos do Processo Licitatório e da
 * Contratação Direta, importar contratos externos e produzir minutas robustas de
 * contratos, aditivos, apostilamentos e rescisões.
 */

type View = "list" | "new" | "imported";

export default function ContractsHome() {
  const [view, setView] = React.useState<View>("list");
  const [contractId, setContractId] = React.useState("");

  const open = (id: string) => setContractId(id);

  if (contractId) {
    return (
      <div className="space-y-4">
        <ContractWorkspace contractId={contractId} onBack={() => setContractId("")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Contratos e Instrumentos Contratuais</h1>
          <p className="text-xs text-muted-foreground">Geração inteligente de documentos contratuais — foco documental, nunca ERP.</p>
        </div>
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          <button type="button" onClick={() => setView("list")} className={`rounded-md px-3 py-1 transition ${view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Todos</button>
          <button type="button" onClick={() => setView("imported")} className={`rounded-md px-3 py-1 transition ${view === "imported" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Importados</button>
          <button type="button" onClick={() => setView("new")} className={`rounded-md px-3 py-1 transition ${view === "new" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Novo</button>
        </div>
      </header>

      {view === "new" && <NewContractWizard onCreated={open} />}
      {view === "imported" && <ImportedContracts onOpen={open} />}
      {view === "list" && <ContractOverview onOpen={open} />}
    </div>
  );
}
