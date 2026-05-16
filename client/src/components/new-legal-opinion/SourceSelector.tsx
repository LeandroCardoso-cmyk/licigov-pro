import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SourceType = "process" | "direct_contract" | "contract" | "other";

interface Process { id: number; name: string }
interface DirectContract { id: number; object: string }
interface Contract { id: number; number: string; object: string }

interface Props {
  sourceType: SourceType;
  sourceId: string;
  processes: Process[] | undefined;
  directContracts: DirectContract[] | undefined;
  contracts: Contract[] | undefined;
  onSourceTypeChange: (v: SourceType) => void;
  onSourceIdChange: (v: string) => void;
}

export function SourceSelector({
  sourceType, sourceId, processes, directContracts, contracts,
  onSourceTypeChange, onSourceIdChange,
}: Props) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="sourceType">Relacionado a</Label>
        <Select value={sourceType} onValueChange={(v: any) => { onSourceTypeChange(v); onSourceIdChange(""); }}>
          <SelectTrigger id="sourceType"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="process">Processo Licitatório</SelectItem>
            <SelectItem value="direct_contract">Contratação Direta</SelectItem>
            <SelectItem value="contract">Contrato</SelectItem>
            <SelectItem value="other">Outro (Consulta Geral)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sourceType !== "other" && (
        <div className="space-y-2">
          <Label htmlFor="sourceId">
            {sourceType === "process" && "Selecionar Processo"}
            {sourceType === "direct_contract" && "Selecionar Contratação"}
            {sourceType === "contract" && "Selecionar Contrato"}
          </Label>
          <Select value={sourceId} onValueChange={onSourceIdChange}>
            <SelectTrigger id="sourceId"><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {sourceType === "process" && processes?.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
              ))}
              {sourceType === "direct_contract" && directContracts?.map((dc) => (
                <SelectItem key={dc.id} value={dc.id.toString()}>{dc.object}</SelectItem>
              ))}
              {sourceType === "contract" && contracts?.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.number} - {c.object}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
