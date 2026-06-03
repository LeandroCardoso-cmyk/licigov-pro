import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, AtSign } from "lucide-react";

interface CommentComposerProps {
  onSubmit: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  availableUsers?: { userId: number; name: string }[];
}

export function CommentComposer({
  onSubmit,
  placeholder = "Escreva um comentário... Use @userId para mencionar alguém",
  disabled = false,
  availableUsers = [],
}: CommentComposerProps) {
  const [content, setContent] = useState("");
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const detectedMentions = (content.match(/@(\d+)/g) ?? []).map((m) =>
    parseInt(m.slice(1), 10),
  );

  function handleChange(value: string) {
    setContent(value);
    // Simple autocomplete trigger: last word starts with @
    const lastWord = value.split(/\s/).pop() ?? "";
    if (lastWord.startsWith("@") && lastWord.length > 1) {
      setMentionFilter(lastWord.slice(1));
      setShowMentionList(availableUsers.length > 0);
    } else if (lastWord === "@") {
      setMentionFilter("");
      setShowMentionList(availableUsers.length > 0);
    } else {
      setShowMentionList(false);
    }
  }

  function insertMention(userId: number, name: string) {
    const words = content.split(/(\s)/);
    const lastWordIdx = words.length - 1;
    words[lastWordIdx] = `@${userId} `;
    setContent(words.join(""));
    setShowMentionList(false);
    textareaRef.current?.focus();
    void name; // suppress unused warning
  }

  function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setContent("");
    setShowMentionList(false);
  }

  const filteredUsers = availableUsers.filter(
    (u) =>
      mentionFilter === "" ||
      u.name.toLowerCase().includes(mentionFilter.toLowerCase()) ||
      String(u.userId).includes(mentionFilter),
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-[80px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        {showMentionList && filteredUsers.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-48 bg-popover border rounded-md shadow-md z-50 max-h-32 overflow-y-auto">
            {filteredUsers.slice(0, 8).map((u) => (
              <button
                key={u.userId}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u.userId, u.name);
                }}
              >
                <AtSign className="w-3 h-3 inline mr-1 text-muted-foreground" />
                {u.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {detectedMentions.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground">Mencionando:</span>
          {detectedMentions.map((uid) => (
            <Badge key={uid} variant="secondary" className="text-xs">
              @{uid}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={disabled || !content.trim()}
        >
          <Send className="w-4 h-4 mr-1" />
          Enviar
        </Button>
      </div>
    </div>
  );
}
