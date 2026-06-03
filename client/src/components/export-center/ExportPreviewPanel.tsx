interface TRClause {
  id:        string;
  content:   string;
  legalBasis?: string;
}

interface TRSection {
  id:       string;
  title:    string;
  order:    number;
  clauses:  TRClause[];
}

interface ExportPreviewPanelProps {
  sections: TRSection[];
}

export function ExportPreviewPanel({ sections }: ExportPreviewPanelProps) {
  return (
    <div className="border rounded-lg p-6 bg-card space-y-4">
      <h3 className="text-lg font-bold text-center">TERMO DE REFERENCIA - Preview</h3>
      {sections.map(section => (
        <div key={section.id} className="space-y-2">
          <h4 className="font-semibold text-sm">
            {section.order}. {section.title}
          </h4>
          {section.clauses.map(clause => (
            <div key={clause.id} className="text-sm text-muted-foreground pl-4">
              <p>{clause.content}</p>
              {clause.legalBasis && (
                <p className="text-xs italic mt-1">Base legal: {clause.legalBasis}</p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
