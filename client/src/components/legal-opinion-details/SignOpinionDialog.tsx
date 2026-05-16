import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Shield, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opinionId: number;
  isPending: boolean;
  onSign: (args: { id: number; signerRole: "revisor" | "responsavel" | "gestor"; signaturePassword: string }) => void;
}

export function SignOpinionDialog({ open, onOpenChange, opinionId, isPending, onSign }: Props) {
  const [signerRole, setSignerRole] = useState<"revisor" | "responsavel" | "gestor">("responsavel");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleConfirm = () => {
    if (!password) {
      toast.error("Digite sua senha de assinatura");
      return;
    }
    onSign({ id: opinionId, signerRole, signaturePassword: password });
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setPassword("");
      setShowPassword(false);
    }
    onOpenChange(v);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-[550px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Assinar Digitalmente
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>Você está prestes a assinar digitalmente este parecer jurídico.</p>

              <div className="space-y-2">
                <Label htmlFor="signerRole" className="text-foreground font-medium">
                  Você está assinando como:
                </Label>
                <Select value={signerRole} onValueChange={(v: any) => setSignerRole(v)}>
                  <SelectTrigger id="signerRole">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revisor">Advogado Revisor</SelectItem>
                    <SelectItem value="responsavel">Advogado Responsável</SelectItem>
                    <SelectItem value="gestor">Gestor Jurídico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signaturePassword" className="text-foreground font-medium">
                  Senha de Assinatura:
                </Label>
                <div className="relative">
                  <Input
                    id="signaturePassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Digite sua senha de assinatura"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isPending}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="bg-muted p-3 rounded-md space-y-2">
                <p className="text-sm font-medium text-foreground">O que acontece ao assinar?</p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>Sua identidade será vinculada a este documento</li>
                  <li>Um hash criptográfico SHA-256 será gerado</li>
                  <li>A assinatura será incluída nas exportações PDF/DOCX</li>
                  <li>Esta ação não pode ser desfeita</li>
                </ul>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assinando...</>
            ) : (
              <><Shield className="h-4 w-4 mr-2" />Confirmar Assinatura</>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
