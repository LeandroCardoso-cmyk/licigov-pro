import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, User } from "lucide-react";

export const ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Atualização",
  delete: "Exclusão",
  view: "Visualização",
  other: "Outro",
};

export const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-500/10 text-green-700 dark:text-green-400",
  update: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  delete: "bg-red-500/10 text-red-700 dark:text-red-400",
  view: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
  other: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

interface Activity {
  id: number;
  action: string;
  description?: string | null;
  userName?: string | null;
  createdAt: string | Date;
}

interface Props {
  activity: Activity;
}

export function ActivityLogCard({ activity }: Props) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Badge className={ACTION_COLORS[activity.action] || ACTION_COLORS.other}>
                {ACTION_LABELS[activity.action] || activity.action}
              </Badge>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {new Date(activity.createdAt).toLocaleString("pt-BR")}
              </div>
              {activity.userName && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  {activity.userName}
                </div>
              )}
            </div>
            <p className="text-sm">{activity.description || "Sem descrição"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
