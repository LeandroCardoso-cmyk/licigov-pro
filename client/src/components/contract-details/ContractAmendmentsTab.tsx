import { FileText, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Amendment } from "./types";

const AMENDMENT_LABELS: Record<string, string> = {
  prazo: "Prazo",
  valor: "Valor",
  escopo: "Escopo",
  misto: "Misto",
};

const brl = (value: number, signDisplay: "auto" | "always" = "auto") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", signDisplay }).format(value);

interface Props {
  amendments: Amendment[] | undefined;
  onNewAmendment: () => void;
}

export function ContractAmendmentsTab({ amendments, onNewAmendment }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Aditivos Contratuais</h3>
          <p className="text-sm text-muted-foreground">
            Alterações de prazo, valor ou escopo do contrato
          </p>
        </div>
        <Button onClick={onNewAmendment}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Aditivo
        </Button>
      </div>

      {amendments && amendments.length > 0 ? (
        <div className="space-y-4">
          {amendments.map((amendment, index) => (
            <Card key={amendment.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Aditivo #{amendments.length - index}
                  </CardTitle>
                  <Badge variant="outline">
                    {AMENDMENT_LABELS[amendment.type] ?? amendment.type}
                  </Badge>
                </div>
                <CardDescription>
                  {new Date(amendment.createdAt).toLocaleDateString("pt-BR")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <span className="text-sm text-muted-foreground">Justificativa</span>
                  <p className="text-sm">{amendment.justification}</p>
                </div>
                {amendment.newEndDate && (
                  <div>
                    <span className="text-sm text-muted-foreground">Nova Data de Término</span>
                    <p className="font-medium">
                      {new Date(amendment.newEndDate).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                )}
                {amendment.valueChange != null && (
                  <div>
                    <span className="text-sm text-muted-foreground">Alteração de Valor</span>
                    <p className="font-medium">{brl(amendment.valueChange ?? 0, "always")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum aditivo registrado</h3>
            <p className="text-muted-foreground mb-4">
              Adicione aditivos para registrar alterações no contrato
            </p>
            <Button onClick={onNewAmendment}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Aditivo
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
