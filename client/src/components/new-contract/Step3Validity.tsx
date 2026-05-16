import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  startDate: string;
  endDate: string;
  autoRenewal: boolean;
  maxRenewals: string;
  fiscalUserName: string;
  durationDays: number;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onAutoRenewalChange: (v: boolean) => void;
  onMaxRenewalsChange: (v: string) => void;
  onFiscalUserNameChange: (v: string) => void;
}

export function Step3Validity({
  startDate, endDate, autoRenewal, maxRenewals, fiscalUserName, durationDays,
  onStartDateChange, onEndDateChange, onAutoRenewalChange, onMaxRenewalsChange, onFiscalUserNameChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="startDate">Data de Início *</Label>
          <Input id="startDate" type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="endDate">Data de Término *</Label>
          <Input id="endDate" type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} />
        </div>
      </div>

      {startDate && endDate && (
        <div className="p-3 bg-muted rounded-md">
          <p className="text-sm text-muted-foreground">
            Prazo: <span className="font-semibold text-foreground">{durationDays} dias</span>
          </p>
        </div>
      )}

      <div className="flex items-center space-x-2">
        <Checkbox
          id="autoRenewal"
          checked={autoRenewal}
          onCheckedChange={(checked) => onAutoRenewalChange(checked as boolean)}
        />
        <Label htmlFor="autoRenewal" className="cursor-pointer">Permitir renovação automática</Label>
      </div>

      {autoRenewal && (
        <div>
          <Label htmlFor="maxRenewals">Número Máximo de Renovações</Label>
          <Input
            id="maxRenewals"
            type="number"
            min="0"
            value={maxRenewals}
            onChange={(e) => onMaxRenewalsChange(e.target.value)}
          />
        </div>
      )}

      <div>
        <Label htmlFor="fiscalUserName">Fiscal do Contrato</Label>
        <Input
          id="fiscalUserName"
          placeholder="Nome do servidor responsável"
          value={fiscalUserName}
          onChange={(e) => onFiscalUserNameChange(e.target.value)}
        />
      </div>
    </div>
  );
}
