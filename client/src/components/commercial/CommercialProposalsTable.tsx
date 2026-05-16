import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Loader2, CheckCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  proposals: any[];
  activateIsPending: boolean;
  onRegisterEmpenho: (proposal: any) => void;
  onActivate: (id: number) => void;
}

export function CommercialProposalsTable({ proposals, activateIsPending, onRegisterEmpenho, onActivate }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const filtered = proposals.filter((p) => {
    const matchesSearch =
      !searchTerm ||
      p.orgaoNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.responsavelNome.toLowerCase().includes(searchTerm.toLowerCase());
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
        <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
          <SelectTrigger className="w-full md:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="approved">Aprovado</SelectItem>
            <SelectItem value="rejected">Rejeitado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Órgão</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Plano</TableHead>
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
                  <TableCell><Badge variant="outline">{proposal.planName}</Badge></TableCell>
                  <TableCell>
                    {proposal.status === "pending" ? (
                      <Badge variant="secondary">Pendente</Badge>
                    ) : proposal.status === "approved" ? (
                      <Badge variant="default" className="bg-green-600">Aprovado</Badge>
                    ) : (
                      <Badge variant="destructive">Rejeitado</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {format(new Date(proposal.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                    </div>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {proposal.status === "pending" && !proposal.empenhoNumero && (
                      <Button variant="outline" size="sm" onClick={() => onRegisterEmpenho(proposal)}>
                        <FileText className="w-4 h-4 mr-1" />
                        Registrar Empenho
                      </Button>
                    )}
                    {proposal.empenhoNumero && proposal.status === "pending" && (
                      <Button variant="default" size="sm" onClick={() => onActivate(proposal.id)} disabled={activateIsPending}>
                        {activateIsPending ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4 mr-1" />
                        )}
                        Ativar Assinatura
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Nenhuma proposta encontrada
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
