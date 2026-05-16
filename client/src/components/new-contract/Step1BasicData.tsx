import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  number: string;
  year: number;
  object: string;
  type: string;
  value: string;
  notes: string;
  onNumberChange: (v: string) => void;
  onYearChange: (v: number) => void;
  onObjectChange: (v: string) => void;
  onTypeChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onNotesChange: (v: string) => void;
}

export function Step1BasicData({
  number, year, object, type, value, notes,
  onNumberChange, onYearChange, onObjectChange, onTypeChange, onValueChange, onNotesChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="number">Número do Contrato *</Label>
          <Input id="number" placeholder="Ex: 001" value={number} onChange={(e) => onNumberChange(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="year">Ano *</Label>
          <Input id="year" type="number" value={year} onChange={(e) => onYearChange(parseInt(e.target.value))} />
        </div>
      </div>

      <div>
        <Label htmlFor="object">Objeto do Contrato *</Label>
        <Textarea
          id="object"
          placeholder="Descreva o objeto do contrato..."
          value={object}
          onChange={(e) => onObjectChange(e.target.value)}
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="type">Tipo de Contrato *</Label>
          <Select value={type} onValueChange={onTypeChange}>
            <SelectTrigger id="type">
              <SelectValue placeholder="Selecione o tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fornecimento">Fornecimento</SelectItem>
              <SelectItem value="servico">Serviço</SelectItem>
              <SelectItem value="obra">Obra</SelectItem>
              <SelectItem value="concessao">Concessão</SelectItem>
              <SelectItem value="outro">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="value">Valor do Contrato (R$) *</Label>
          <Input id="value" placeholder="Ex: 150.000,00" value={value} onChange={(e) => onValueChange(e.target.value)} />
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Observações</Label>
        <Textarea
          id="notes"
          placeholder="Informações adicionais..."
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
        />
      </div>
    </div>
  );
}
