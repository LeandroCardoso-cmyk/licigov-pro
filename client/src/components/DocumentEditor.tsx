import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Button } from './ui/button';
import { Save, X, Bold, Italic, List, ListOrdered, Undo, Redo, Check, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useDebounce } from 'use-debounce';

interface DocumentEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving?: boolean;
  autoSave?: boolean;
  onAutoSave?: (content: string) => Promise<void>;
}

export function DocumentEditor({ 
  initialContent, 
  onSave, 
  onCancel, 
  isSaving = false,
  autoSave = true,
  onAutoSave 
}: DocumentEditorProps) {
  const [hasChanges, setHasChanges] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [debouncedContent] = useDebounce(content, 2000);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Comece a editar o documento...',
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      setHasChanges(true);
      setContent(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none focus:outline-none min-h-[500px] p-4',
      },
    },
  });

  const handleSave = () => {
    if (editor) {
      const content = editor.getHTML();
      onSave(content);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      if (confirm('Você tem alterações não salvas. Deseja realmente cancelar?')) {
        onCancel();
      }
    } else {
      onCancel();
    }
  };

  // Auto-save effect
  useEffect(() => {
    if (autoSave && onAutoSave && debouncedContent !== initialContent && hasChanges) {
      setAutoSaving(true);
      onAutoSave(debouncedContent)
        .then(() => {
          setLastSaved(new Date());
          setHasChanges(false);
        })
        .catch((error) => {
          console.error('Auto-save failed:', error);
        })
        .finally(() => {
          setAutoSaving(false);
        });
    }
  }, [debouncedContent, autoSave, onAutoSave, initialContent, hasChanges]);

  if (!editor) {
    return null;
  }

  const formatLastSaved = () => {
    if (!lastSaved) return null;
    const now = new Date();
    const diff = Math.floor((now.getTime() - lastSaved.getTime()) / 1000);
    if (diff < 60) return 'há poucos segundos';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} minutos`;
    return lastSaved.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="border-b bg-muted/30 p-2 flex flex-wrap gap-1 items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'bg-accent' : ''}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'bg-accent' : ''}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'bg-accent' : ''}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'bg-accent' : ''}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
        >
          <Redo className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        {autoSave && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-3">
            {autoSaving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Salvando...
              </>
            ) : lastSaved ? (
              <>
                <Check className="h-3 w-3 text-green-500" />
                Salvo {formatLastSaved()}
              </>
            ) : null}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={isSaving}
        >
          <X className="mr-2 h-4 w-4" />
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
        >
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? 'Salvando...' : 'Salvar Alterações'}
        </Button>
      </div>

      {/* Editor */}
      <div className="bg-background">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
