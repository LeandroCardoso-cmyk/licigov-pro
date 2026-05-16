import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, User, Users, TrendingUp } from "lucide-react";

interface AdminUser {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
  createdAt: Date | string;
}

interface Props {
  users: AdminUser[];
  currentUserId: number;
  promotePending: boolean;
  demotePending: boolean;
  onPromote: (userId: number) => void;
  onDemote: (userId: number) => void;
}

export function AdminUsersTable({ users, currentUserId, promotePending, demotePending, onPromote, onDemote }: Props) {
  return (
    <Card className="border-2 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2 text-2xl">
          <Users className="h-6 w-6 text-blue-600" />
          Usuários Cadastrados
        </CardTitle>
        <CardDescription className="text-base">Total de {users.length} usuários no sistema</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between border-b pb-4 last:border-b-0 hover:bg-gray-50 p-3 rounded-lg transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  u.role === "admin" ? "bg-gradient-to-br from-blue-500 to-indigo-600" : "bg-gray-200"
                }`}>
                  {u.role === "admin" ? <Shield className="h-6 w-6 text-white" /> : <User className="h-6 w-6 text-gray-600" />}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{u.name || "Sem nome"}</div>
                  <div className="text-sm text-gray-600">{u.email || "Sem email"}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    ID: {u.id} • Cadastrado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant={u.role === "admin" ? "default" : "secondary"}
                  className={u.role === "admin" ? "bg-gradient-to-r from-blue-600 to-indigo-600" : ""}
                >
                  {u.role === "admin" ? "Administrador" : "Usuário"}
                </Badge>
                {u.id !== currentUserId ? (
                  u.role === "admin" ? (
                    <Button variant="outline" size="sm" onClick={() => onDemote(u.id)} disabled={demotePending} className="hover:bg-red-50 hover:border-red-300">
                      <TrendingUp className="mr-2 h-4 w-4 rotate-180" />Rebaixar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => onPromote(u.id)} disabled={promotePending} className="hover:bg-blue-50 hover:border-blue-300">
                      <TrendingUp className="mr-2 h-4 w-4" />Promover
                    </Button>
                  )
                ) : (
                  <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">Você</Badge>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 text-gray-400" />
              <p>Nenhum usuário cadastrado</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
