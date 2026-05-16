import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

interface Process {
  id: number;
  name: string;
  description?: string | null;
  modality?: string | null;
  status: string;
}

interface Props {
  taskId: number;
  linkedProcess: Process | null | undefined;
  processes: Process[];
  onLink: (processId: number) => void;
  onUnlink: () => void;
}

export function TaskLinkedProcess({ taskId: _taskId, linkedProcess, processes, onLink, onUnlink }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Processo Licitatório
        </CardTitle>
      </CardHeader>
      <CardContent>
        {linkedProcess ? (
          <div className="space-y-2">
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-medium">{linkedProcess.name}</p>
              <p className="text-sm text-muted-foreground mt-1">{linkedProcess.description || "Sem descrição"}</p>
              <div className="flex gap-2 mt-2">
                <Badge variant="outline">{linkedProcess.modality || "Modalidade não definida"}</Badge>
                <Badge variant="outline">{linkedProcess.status}</Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onUnlink}>Desvincular Processo</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Nenhum processo vinculado</p>
            {processes.length > 0 && (
              <select
                className="w-full p-2 border rounded-md"
                onChange={(e) => { const id = parseInt(e.target.value); if (id) onLink(id); }}
                defaultValue=""
              >
                <option value="" disabled>Selecione um processo...</option>
                {processes.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
