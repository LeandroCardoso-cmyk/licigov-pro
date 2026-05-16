import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sparkles } from "lucide-react";

interface Platform {
  id: number;
  name: string;
}

interface Props {
  number: string;
  year: number;
  object: string;
  justification: string;
  value: string;
  executionDeadline: string;
  mode: "presencial" | "eletronico";
  platformId: number | undefined;
  selectedArticleId: number | null;
  loadingAI: boolean;
  platforms: Platform[] | undefined;
  onNumberChange: (v: string) => void;
  onYearChange: (v: number) => void;
  onObjectChange: (v: string) => void;
  onJustificationChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onExecutionDeadlineChange: (v: string) => void;
  onModeChange: (v: "presencial" | "eletronico") => void;
  onPlatformIdChange: (v: number) => void;
  onGenerateJustification: () => void;
}

export function Step2ContractData({
  number, year, object, justification, value, executionDeadline, mode, platformId,
  selectedArticleId, loadingAI, platforms,
  onNumberChange, onYearChange, onObjectChange, onJustificationChange, onValueChange,
  onExecutionDeadlineChange, onModeChange, onPlatformIdChange, onGenerateJustification,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="number">Número *</Label>
          <Input id="number" value={number} onChange={(e) => onNumberChange(e.target.value)} placeholder="Ex: 001" />
        </div>
        <div>
          <Label htmlFor="year">Ano *</Label>
          <Input id="year" type="number" value={year} onChange={(e) => onYearChange(parseInt(e.target.value))} />
        </div>
      </div>

      <div>
        <Label htmlFor="object-step2">Objeto da Contratação *</Label>
        <Textarea
          id="object-step2"
          value={object}
          onChange={(e) => onObjectChange(e.target.value)}
          placeholder="Descreva detalhadamente o objeto"
          rows={3}
        />
      </div>

      <div>
        <Label htmlFor="justification">Justificativa *</Label>
        <Textarea
          id="justification"
          value={justification}
          onChange={(e) => onJustificationChange(e.target.value)}
          placeholder="Justificativa técnica e jurídica"
          rows={6}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={onGenerateJustification}
          disabled={loadingAI || !selectedArticleId}
          className="mt-2"
        >
          {loadingAI ? "Gerando..." : <><Sparkles className="w-4 h-4 mr-2" />Gerar com IA</>}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="value-step2">Valor (R$) *</Label>
          <Input id="value-step2" type="number" value={value} onChange={(e) => onValueChange(e.target.value)} step="0.01" />
        </div>
        <div>
          <Label htmlFor="executionDeadline">Prazo de Execução (dias)</Label>
          <Input
            id="executionDeadline"
            type="number"
            value={executionDeadline}
            onChange={(e) => onExecutionDeadlineChange(e.target.value)}
            placeholder="Ex: 30"
          />
        </div>
      </div>

      <Separator />

      <div>
        <Label htmlFor="mode">Modo de Contratação *</Label>
        <Select value={mode} onValueChange={(v: any) => onModeChange(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="presencial">Presencial (ZIP + Email)</SelectItem>
            <SelectItem value="eletronico">Eletrônico (Plataforma)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "eletronico" && (
        <div>
          <Label htmlFor="platform">Plataforma</Label>
          <Select value={platformId?.toString() || ""} onValueChange={(v) => onPlatformIdChange(parseInt(v))}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a plataforma" />
            </SelectTrigger>
            <SelectContent>
              {platforms?.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
