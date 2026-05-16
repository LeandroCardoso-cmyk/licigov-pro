import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles, FileText } from "lucide-react";
import { Streamdown } from "streamdown";
import type { LegalOpinion } from "./types";

interface Props {
  opinion: LegalOpinion;
  isGenerating: boolean;
  onGenerate: () => void;
}

export function LegalOpinionContent({ opinion, isGenerating, onGenerate }: Props) {
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
            <Sparkles className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">Parecer ainda não gerado</p>
            <p className="text-sm text-muted-foreground mb-4">
              Clique em "Gerar com IA" para criar a análise jurídica
            </p>
            <Button onClick={onGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" />Gerar com IA</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
