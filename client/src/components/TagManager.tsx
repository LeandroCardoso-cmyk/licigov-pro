import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Tag as TagIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface TagManagerProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  availableTags?: string[];
}

/**
 * Componente para gerenciar tags personalizadas
 * Permite criar novas tags e selecionar tags existentes
 */
export default function TagManager({ selectedTags, onTagsChange, availableTags = [] }: TagManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [localTags, setLocalTags] = useState<string[]>(availableTags);

  const handleAddTag = () => {
    const trimmedTag = newTag.trim();
    
    if (!trimmedTag) {
      toast.error("Digite um nome para a tag");
      return;
    }

    if (trimmedTag.length > 30) {
      toast.error("Tag muito longa (máximo 30 caracteres)");
      return;
    }

    if (localTags.includes(trimmedTag)) {
      toast.error("Esta tag já existe");
      return;
    }

    setLocalTags([...localTags, trimmedTag]);
    setNewTag("");
    toast.success("Tag criada com sucesso!");
  };

  const handleToggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter(t => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleRemoveTag = (tag: string) => {
    setLocalTags(localTags.filter(t => t !== tag));
    onTagsChange(selectedTags.filter(t => t !== tag));
    toast.success("Tag removida");
  };

  return (
    <div className="space-y-2">
      {/* Tags selecionadas */}
      <div className="flex flex-wrap gap-2">
        {selectedTags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            <TagIcon className="h-3 w-3" />
            {tag}
            <button
              type="button"
              onClick={() => handleToggleTag(tag)}
              className="ml-1 hover:bg-muted rounded-full p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      {/* Botão para abrir modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Gerenciar Tags
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gerenciar Tags</DialogTitle>
            <DialogDescription>
              Crie novas tags ou selecione tags existentes para categorizar a tarefa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Criar nova tag */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Criar Nova Tag</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Nome da tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  maxLength={30}
                />
                <Button type="button" onClick={handleAddTag}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Tags disponíveis */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags Disponíveis</label>
              {localTags.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma tag criada ainda. Crie sua primeira tag acima!
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 border rounded-lg">
                  {localTags.map((tag) => (
                    <div key={tag} className="flex items-center gap-1">
                      <Badge
                        variant={selectedTags.includes(tag) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => handleToggleTag(tag)}
                      >
                        <TagIcon className="h-3 w-3 mr-1" />
                        {tag}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:bg-destructive/10 rounded-full p-1"
                        title="Remover tag"
                      >
                        <X className="h-3 w-3 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ações */}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
