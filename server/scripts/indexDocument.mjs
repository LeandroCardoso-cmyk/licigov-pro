import { readFileSync } from "fs";
import { config } from "dotenv";
import { generateEmbedding } from "../services/embeddings.js";
import { drizzle } from "drizzle-orm/mysql2";

// Carregar variáveis de ambiente
config();

/**
 * Script genérico para indexar qualquer documento legal no sistema RAG
 * 
 * Uso:
 * node server/scripts/indexDocument.mjs <lawName> <filePath> [chunkSize]
 * 
 * Exemplos:
 * node server/scripts/indexDocument.mjs "Lei 8.666/93" data/lei_8666_1993.txt
 * node server/scripts/indexDocument.mjs "Decreto 11.462/2023" data/decreto_11462_2023.txt 600
 */

const lawName = process.argv[2];
const filePath = process.argv[3];
const chunkSize = parseInt(process.argv[4] || "512");

if (!lawName || !filePath) {
  console.error("❌ Uso: node indexDocument.mjs <lawName> <filePath> [chunkSize]");
  console.error("\nExemplos:");
  console.error('  node indexDocument.mjs "Lei 8.666/93" data/lei_8666_1993.txt');
  console.error('  node indexDocument.mjs "Decreto 11.462/2023" data/decreto_11462_2023.txt 600');
  process.exit(1);
}

console.log("📚 Indexando Documento Legal");
console.log("=".repeat(60));
console.log(`Documento: ${lawName}`);
console.log(`Arquivo: ${filePath}`);
console.log(`Tamanho do chunk: ${chunkSize} caracteres`);
console.log("=".repeat(60));

async function indexDocument() {
  try {
    // 1. Ler arquivo
    console.log("\n📖 Lendo arquivo...");
    const content = readFileSync(filePath, "utf-8");
    console.log(`   Tamanho: ${content.length} caracteres`);

    // 2. Dividir em chunks
    console.log("\n✂️  Dividindo em chunks...");
    const chunks = [];
    let currentChunk = "";
    let chunkIndex = 0;

    const lines = content.split("\n");
    for (const line of lines) {
      // Detectar artigos (Art. X, Artigo X, etc)
      const articleMatch = line.match(/^(Art\.|Artigo)\s+(\d+[º°]?)/i);

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
    const db = drizzle(process.env.DATABASE_URL);

    // 4. Gerar embeddings e inserir
    console.log("\n🤖 Gerando embeddings e inserindo no banco...");
    let inserted = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk.content);

        await db.execute(`
          INSERT INTO law_chunks (lawName, chunkIndex, articleNumber, content, embedding, createdAt)
          VALUES (?, ?, ?, ?, ?, NOW())
        `, [
          lawName,
          chunk.index,
          chunk.articleNumber,
          chunk.content,
          JSON.stringify(embedding),
        ]);

        inserted++;
        if (inserted % 10 === 0) {
          console.log(`   Progresso: ${inserted}/${chunks.length} chunks`);
        }
      } catch (error) {
        console.error(`   ❌ Erro ao processar chunk ${chunk.index}:`, error.message);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Indexação concluída com sucesso!");
    console.log(`   Documento: ${lawName}`);
    console.log(`   Chunks inseridos: ${inserted}/${chunks.length}`);
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Erro durante a indexação:", error);
    process.exit(1);
  }

  process.exit(0);
}

/**
 * Extrai o número do artigo do conteúdo do chunk
 */
function extractArticleNumber(content) {
  const match = content.match(/^(Art\.|Artigo)\s+(\d+[º°]?)/im);
  if (match) {
    return `Art. ${match[2]}`;
  }
  return null;
}

// Executar
indexDocument();
