import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Archive } from "lucide-react";
import { Link } from "wouter";
import { Streamdown } from "streamdown";
import type { LegalOpinion } from "./types";

interface Props {
  opinion: LegalOpinion;
}

/** R2 / PR-03 (LEG-012) — leitura histórica do parecer legado: nenhuma ação de geração/edição. */
export function LegalOpinionContent({ opinion }: Props) {
  return (
    <div className="lg:col-span-2 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Questão Jurídica</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-foreground whitespace-pre-wrap">{opinion.legalQuestion}</p>
        </CardContent>
      </Card>

      {opinion.context && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contexto Adicional</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground whitespace-pre-wrap">{opinion.context}</p>
          </CardContent>
        </Card>
      )}

      {opinion.opinion ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Parecer Jurídico
            </CardTitle>
            <CardDescription>Análise fundamentada na Lei 14.133/2021</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Streamdown>{opinion.opinion}</Streamdown>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Archive className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">Parecer legado sem conteúdo registrado</p>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Este registro do módulo antigo é somente leitura. Para elaborar um parecer, use o{" "}
              <Link href="/parecer" className="underline">workspace do Parecer Jurídico</Link>.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
