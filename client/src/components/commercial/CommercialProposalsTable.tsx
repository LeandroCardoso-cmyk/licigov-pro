import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Status reais de `proposal_requests.status` (antes a tela filtrava por "approved"/"rejected", que não existem). */
export type ProposalStatus = "pending" | "documents_sent" | "empenho_received" | "activated" | "cancelled";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: "Recebida",
  documents_sent: "Proposta enviada",
  empenho_received: "Empenho registrado",
  activated: "Concluída",
  cancelled: "Cancelada",
};

export interface CommercialProposalRow {
  id: number;
  orgaoNome: string;
  orgaoCidade: string;
  orgaoEstado: string;
  responsavelNome: string;
  responsavelEmail: string;
  planSlug: string | null;
  planName: string | null;
  status: ProposalStatus;
  numeroEmpenho: string | null;
  createdAt: string | Date;
}

interface Props {
  proposals: CommercialProposalRow[];
  onRegisterEmpenho: (proposal: CommercialProposalRow) => void;
}

/**
 * LICIGOV-LAUNCH-READY LR-03 — a ação "Ativar Assinatura" foi REMOVIDA: enviava o id da proposta como id de usuário e criava
 * assinatura para um usuário arbitrário. A concessão de acesso é por organização (Administração › Organizações).
 */
export function CommercialProposalsTable({ proposals, onRegisterEmpenho }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | ProposalStatus>("all");

  const filtered = proposals.filter((p) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q || p.orgaoNome.toLowerCase().includes(q) || p.responsavelNome.toLowerCase().includes(q);
    return matchesSearch && (filterStatus === "all" || p.status === filterStatus);
  });

  return (
    <>
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Buscar por órgão ou responsável..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as "all" | ProposalStatus)}>
          <SelectTrigger className="w-full md:w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(STATUS_LABEL) as ProposalStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Órgão</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Preferência informada</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((proposal) => (
                <TableRow key={proposal.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{proposal.orgaoNome}</div>
                      <div className="text-sm text-muted-foreground">{proposal.orgaoCidade}/{proposal.orgaoEstado}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{proposal.responsavelNome}</div>
                      <div className="text-sm text-muted-foreground">{proposal.responsavelEmail}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{proposal.planName ?? proposal.planSlug ?? "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={proposal.status === "cancelled" ? "destructive" : "secondary"}>{STATUS_LABEL[proposal.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{format(new Date(proposal.createdAt), "dd/MM/yyyy", { locale: ptBR })}</div>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {proposal.status !== "cancelled" && !proposal.numeroEmpenho && (
                      <Button variant="outline" size="sm" onClick={() => onRegisterEmpenho(proposal)}>
                        <FileText className="w-4 h-4 mr-1" />
                        Registrar empenho (registro interno)
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Nenhuma solicitação encontrada
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
