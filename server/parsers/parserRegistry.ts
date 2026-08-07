/**
 * Sprint 2.8 — ParserRegistry.
 * Registro central de todos os parsers disponíveis.
 * Seleção por MIME type, extensão ou parserType string.
 */
import type { BaseParser } from "./baseParser";
import type { ParserType } from "../domain/importTypes";

export class ParserRegistry {
  private readonly parsers = new Map<string, BaseParser>();

  register(parser: BaseParser): this {
    this.parsers.set(parser.parserType, parser);
    return this;
  }

  get(parserType: string): BaseParser | null {
    return this.parsers.get(parserType) ?? null;
  }

  getForMimeType(mimeType: string): BaseParser | null {
    for (const parser of this.parsers.values()) {
      if (parser.capabilities.supportedMimeTypes.includes(mimeType)) return parser;
    }
    return null;
  }

  getForExtension(ext: string): BaseParser | null {
    const normalized = ext.toLowerCase().replace(/^\./, "");
    for (const parser of this.parsers.values()) {
      if (parser.capabilities.supportedExtensions.includes(normalized)) return parser;
    }
    return null;
  }

  resolve(mimeType: string, filename: string, hint?: ParserType): BaseParser | null {
    if (hint && hint !== "auto") {
      const direct = this.get(hint);
      if (direct) return direct;
    }
    const byMime = this.getForMimeType(mimeType);
    if (byMime) return byMime;
    const ext = filename.split(".").pop() ?? "";
    return this.getForExtension(ext);
  }

  list(): BaseParser[] {
    return Array.from(this.parsers.values());
  }

  has(parserType: string): boolean {
    return this.parsers.has(parserType);
  }
}

export const parserRegistry = new ParserRegistry();

// Self-registering parsers at module init — order doesn't matter (resolve uses priority: hint > mime > ext)
import { csvParser }  from "./csvParser";
import { xlsxParser } from "./xlsxParser";
import { pdfParser }  from "./pdfParser";
import { docxParser } from "./docxParser";

parserRegistry
  .register(csvParser)
  .register(xlsxParser)
  .register(pdfParser)
  .register(docxParser);
