import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Upload, Loader2, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DocumentUploadDialog,
  DOCUMENT_TYPES,
  type UploadData,
} from "@/components/admin-documents/DocumentUploadDialog";

function getStatusBadge(expiresAt: string | null) {
  if (!expiresAt) return <Badge variant="outline">Indeterminado</Badge>;
  const days = differenceInDays(new Date(expiresAt), new Date());
  if (days < 0) {
    return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />Vencido</Badge>;
  } else if (days <= 30) {
    return <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800"><AlertCircle className="w-3 h-3" />Vence em {days} dias</Badge>;
  }
  return <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle className="w-3 h-3" />Válido</Badge>;
}

export default function AdminDocuments() {
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadData, setUploadData] = useState<UploadData>({ documentType: "", expiresAt: "", file: null });

  const { data: documents, isLoading, refetch } = trpc.companyDocuments.list.useQuery();
  const uploadMutation = (trpc as any).companyDocuments.upload?.useMutation?.() ?? trpc.companyDocuments.create.useMutation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setUploadData({ ...uploadData, file: e.target.files[0] });
  };

  const handleUpload = async () => {
    if (!uploadData.file || !uploadData.documentType) {
      toast.error("Selecione o tipo de documento e o arquivo");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        await uploadMutation.mutateAsync({
          documentType: uploadData.documentType,
          fileName: uploadData.file!.name,
          fileData: base64,
          expiresAt: uploadData.expiresAt || undefined,
        });
        toast.success("Documento enviado com sucesso!");
        refetch();
        setShowUploadDialog(false);
        setUploadData({ documentType: "", expiresAt: "", file: null });
      } catch (error: any) {
        toast.error(error.message || "Erro ao enviar documento");
      }
    };
    reader.readAsDataURL(uploadData.file);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  const hasExpiringSoon = documents?.some((doc) => {
    if (!doc.expiresAt) return false;
    const days = differenceInDays(new Date(doc.expiresAt), new Date());
    return days >= 0 && days <= 30;
  });

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Documentos da Empresa</CardTitle>
              <CardDescription>Gerencie os documentos necessários para propostas comerciais</CardDescription>
            </div>
            <Button onClick={() => setShowUploadDialog(true)}>
              <Upload className="w-4 h-4 mr-2" />Enviar Documento
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo de Documento</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Data de Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Última Atualização</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents && documents.length > 0 ? (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">
                            {DOCUMENT_TYPES.find((t) => t.value === doc.type)?.label || doc.type}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell><div className="text-sm text-muted-foreground">{doc.fileName}</div></TableCell>
                      <TableCell>
                        {doc.expiresAt ? (
                          <div className="text-sm">{format(new Date(doc.expiresAt), "dd/MM/yyyy", { locale: ptBR })}</div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(doc.expiresAt ? doc.expiresAt.toISOString() : null)}</TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(doc.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setUploadData({ documentType: doc.type, expiresAt: "", file: null }); setShowUploadDialog(true); }}
                        >
                          Atualizar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhum documento enviado ainda
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {hasExpiringSoon && (
            <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-900">Documentos próximos do vencimento</h4>
                  <p className="text-sm text-amber-700 mt-1">
                    Alguns documentos vencem nos próximos 30 dias. Atualize-os para evitar problemas nas propostas.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <DocumentUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        uploadData={uploadData}
        onUploadDataChange={setUploadData}
        onFileChange={handleFileChange}
        onUpload={handleUpload}
        isPending={uploadMutation.isPending}
      />
    </div>
  );
}
