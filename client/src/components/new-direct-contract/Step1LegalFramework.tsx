import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sparkles } from "lucide-react";

interface Article {
  id: number;
  article: string;
  inciso?: string | null;
  summary?: string | null;
  description?: string | null;
}

interface Props {
  type: string;
  selectedArticleId: number | null;
  situation: string;
  object: string;
  value: string;
  aiSuggestion: any;
  loadingAI: boolean;
  articles: Article[] | undefined;
  onTypeChange: (v: "dispensa" | "inexigibilidade") => void;
  onSituationChange: (v: string) => void;
  onObjectChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onArticleChange: (id: number) => void;
  onSuggestArticle: () => void;
}

export function Step1LegalFramework({
  type, selectedArticleId, situation, object, value,
  aiSuggestion, loadingAI, articles,
  onTypeChange, onSituationChange, onObjectChange, onValueChange,
  onArticleChange, onSuggestArticle,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="type">Tipo de Contratação *</Label>
        <Select value={type} onValueChange={(v: any) => onTypeChange(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dispensa">Dispensa de Licitação</SelectItem>
            <SelectItem value="inexigibilidade">Inexigibilidade de Licitação</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <Alert>
        <Sparkles className="w-4 h-4" />
        <AlertDescription>
          <strong>Assistente IA:</strong> Descreva sua situação e deixe a IA sugerir o artigo legal mais adequado!
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="situation">Descreva a Situação *</Label>
        <Textarea
          id="situation"
          value={situation}
          onChange={(e) => onSituationChange(e.target.value)}
          placeholder="Ex: Necessidade de contratação emergencial de empresa para reparo de bomba d'água..."
          rows={4}
        />
      </div>

      <div>
        <Label htmlFor="object-step1">Objeto da Contratação *</Label>
        <Input
          id="object-step1"
          value={object}
          onChange={(e) => onObjectChange(e.target.value)}
          placeholder="Ex: Contratação de empresa para reparo de bomba d'água"
        />
      </div>

      <div>
        <Label htmlFor="value-step1">Valor Estimado (R$) *</Label>
        <Input
          id="value-step1"
          type="number"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="Ex: 15000.00"
          step="0.01"
        />
      </div>

      <Button
        onClick={onSuggestArticle}
        disabled={loadingAI || !situation || !object || !value}
        className="w-full"
      >
        {loadingAI ? "Analisando..." : <><Sparkles className="w-4 h-4 mr-2" />Sugerir Artigo Legal (IA)</>}
      </Button>

      {aiSuggestion && (
        <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <AlertDescription>
            <div className="space-y-2">
              <div><strong>Artigo Sugerido:</strong> <Badge variant="outline">{aiSuggestion.articleNumber}</Badge></div>
              <div><strong>Confiança:</strong> {aiSuggestion.confidence}%</div>
              <div><strong>Explicação:</strong> {aiSuggestion.reasoning}</div>
              {aiSuggestion.warnings?.length > 0 && (
                <div>
                  <strong>Alertas:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {aiSuggestion.warnings.map((w: string, i: number) => (
                      <li key={i} className="text-sm text-amber-700 dark:text-amber-400">{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      <div>
        <Label htmlFor="article">Artigo Legal *</Label>
        <Select
          value={selectedArticleId?.toString() || ""}
          onValueChange={(v) => onArticleChange(parseInt(v))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o artigo legal" />
          </SelectTrigger>
          <SelectContent>
            {articles?.map((a) => (
              <SelectItem key={a.id} value={a.id.toString()}>
                {a.article} {a.inciso || ""} - {a.summary}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedArticleId && articles && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            {articles.find((a) => a.id === selectedArticleId)?.description}
          </p>
        )}
      </div>
    </div>
  );
}
