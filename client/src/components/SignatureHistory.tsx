import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, User, Calendar, Hash } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface SignatureHistoryProps {
  signatures: Array<{
    id: number;
    userName: string;
    userEmail: string | null;
    signerRole: "revisor" | "responsavel" | "gestor";
    documentHash: string;
    signature: string;
    isValid: boolean;
    signedAt: Date;
  }>;
  requiredSignatures: number;
}

const roleNames = {
  revisor: "Advogado Revisor",
  responsavel: "Advogado Responsável",
  gestor: "Gestor Jurídico",
};

const roleColors = {
  revisor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  responsavel: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  gestor: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

export function SignatureHistory({ signatures, requiredSignatures }: SignatureHistoryProps) {
  const isFullySigned = signatures.length >= requiredSignatures;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Histórico de Assinaturas Digitais</CardTitle>
          </div>
          <Badge variant={isFullySigned ? "default" : "secondary"} className="gap-1">
            {signatures.length}/{requiredSignatures} Assinaturas
          </Badge>
        </div>
        <CardDescription>
          {isFullySigned
            ? "Este parecer possui todas as assinaturas necessárias"
            : `Aguardando ${requiredSignatures - signatures.length} assinatura(s)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {signatures.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Nenhuma assinatura registrada ainda</p>
          </div>
        ) : (
          <div className="space-y-3">
            {signatures.map((sig, index) => (
              <div
                key={sig.id}
                className="border rounded-lg p-4 space-y-3 bg-card hover:bg-accent/50 transition-colors"
              >
                {/* Header da Assinatura */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{sig.userName}</p>
                      {sig.userEmail && (
                        <p className="text-sm text-muted-foreground">{sig.userEmail}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={roleColors[sig.signerRole]}>{roleNames[sig.signerRole]}</Badge>
                    {sig.isValid && (
                      <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                        <CheckCircle2 className="h-3 w-3" />
                        Válida
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Informações da Assinatura */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {format(new Date(sig.signedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Hash className="h-4 w-4" />
                    <span className="font-mono text-xs truncate">
                      {sig.documentHash.substring(0, 16)}...
                    </span>
                  </div>
                </div>

                {/* Ordem da Assinatura */}
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Assinatura #{index + 1} de {requiredSignatures}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rodapé com Status */}
        {isFullySigned && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-medium">
                Parecer totalmente assinado e pronto para uso oficial
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
