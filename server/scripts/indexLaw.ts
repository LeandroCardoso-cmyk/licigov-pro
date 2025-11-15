import { readFileSync } from "fs";
import mysql from "mysql2/promise";
import { generateEmbedding } from "../services/embeddings";

/**
 * Script para indexar documentos legais no sistema RAG
 * 
 * Uso: pnpm tsx server/scripts/indexLaw.ts <lawName> <filePath> [chunkSize]
 */

const lawName = process.argv[2];
const filePath = process.argv[3];
const chunkSize = parseInt(process.argv[4] || "512");

if (!lawName || !filePath) {
  console.error("❌ Uso: pnpm tsx server/scripts/indexLaw.ts <lawName> <filePath> [chunkSize]");
  console.error("\nExemplos:");
  console.error('  pnpm tsx server/scripts/indexLaw.ts "Lei 8.666/93" data/lei_8666_1993.txt');
  console.error('  pnpm tsx server/scripts/indexLaw.ts "Decreto 11.462/2023" data/decreto_11462_2023.txt 600');
  process.exit(1);
}

console.log("📚 Indexando Documento Legal");
console.log("=".repeat(60));
console.log(`Documento: ${lawName}`);
console.log(`Arquivo: ${filePath}`);
console.log(`Tamanho do chunk: ${chunkSize} caracteres`);
console.log("=".repeat(60));

async function indexDocument() {
  let connection: mysql.Connection | null = null;

  try {
    // 1. Ler arquivo
    console.log("\n📖 Lendo arquivo...");
    const content = readFileSync(filePath, "utf-8");
    console.log(`   Tamanho: ${content.length} caracteres`);

    // 2. Dividir em chunks
    console.log("\n✂️  Dividindo em chunks...");
    const chunks: Array<{ index: number; content: string; articleNumber: string | null }> = [];
    let currentChunk = "";
    let chunkIndex = 0;

    const lines = content.split("\n");
    for (const line of lines) {
      if (currentChunk.length + line.length > chunkSize && currentChunk.length > 0) {
        // Salvar chunk atual
        chunks.push({
          index: chunkIndex++,
          content: currentChunk.trim(),
          articleNumber: extractArticleNumber(currentChunk),
        });
        currentChunk = "";
      }

      currentChunk += line + "\n";
    }

    // Adicionar último chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        index: chunkIndex++,
        content: currentChunk.trim(),
        articleNumber: extractArticleNumber(currentChunk),
      });
    }

    console.log(`   Total de chunks: ${chunks.length}`);

    // 3. Conectar ao banco
    console.log("\n🔌 Conectando ao banco de dados...");
    connection = await mysql.createConnection(process.env.DATABASE_URL!);

    // 4. Gerar embeddings e inserir
    console.log("\n🤖 Gerando embeddings e inserindo no banco...");
    let inserted = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk.content);

        await connection.execute(
          `INSERT INTO law_chunks (lawName, chunkIndex, articleNumber, content, embedding, createdAt)
           VALUES (?, ?, ?, ?, CAST(? AS JSON), NOW())`,
          [
            lawName,
            chunk.index,
            chunk.articleNumber,
            chunk.content,
            JSON.stringify(embedding),
          ]
        );

        inserted++;
        if (inserted % 10 === 0) {
          console.log(`   Progresso: ${inserted}/${chunks.length} chunks`);
        }

        // Delay para evitar rate limit (100ms entre requisições)
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        console.error(`   ❌ Erro ao processar chunk ${chunk.index}:`, error.message);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Indexação concluída com sucesso!");
    console.log(`   Documento: ${lawName}`);
    console.log(`   Chunks inseridos: ${inserted}/${chunks.length}`);
    console.log("=".repeat(60));

  } catch (error: any) {
    console.error("\n❌ Erro durante a indexação:", error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }

  process.exit(0);
}

/**
 * Extrai o número do artigo do conteúdo do chunk
 */
function extractArticleNumber(content: string): string | null {
  const match = content.match(/^(Art\.|Artigo)\s+(\d+[º°]?)/im);
  if (match) {
    return `Art. ${match[2]}`;
  }
  return null;
}

// Executar
indexDocument();
