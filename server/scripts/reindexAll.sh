#!/bin/bash

# Script para reindexar todos os documentos legais
# Estimativa total: ~2 horas

cd /home/ubuntu/licigov-pro

echo "=========================================="
echo "🚀 Iniciando reindexação completa"
echo "=========================================="
echo ""

# 1. Lei 14.133/21 (91 chunks - ~1 min)
echo "📄 [1/6] Indexando Lei 14.133/21..."
pnpm tsx server/scripts/indexLaw.ts "Lei 14.133/21" data/lei_14133_2021.txt
echo ""

# 2. Lei 8.666/93 (520 chunks - ~9 min)
echo "📄 [2/6] Indexando Lei 8.666/93..."
pnpm tsx server/scripts/indexLaw.ts "Lei 8.666/93" data/lei_8666_1993.txt
echo ""

# 3. Decreto 11.462/2023 (101 chunks - ~2 min)
echo "📄 [3/6] Indexando Decreto 11.462/2023..."
pnpm tsx server/scripts/indexLaw.ts "Decreto 11.462/2023" data/decreto_11462_2023.txt
echo ""

# 4. IN SEGES 65/2021 (34 chunks - ~1 min)
echo "📄 [4/6] Indexando IN SEGES 65/2021..."
pnpm tsx server/scripts/indexLaw.ts "IN SEGES 65/2021" data/in_seges_65_2021.txt
echo ""

# 5. LC 123/2006 (749 chunks - ~13 min)
echo "📄 [5/6] Indexando LC 123/2006..."
pnpm tsx server/scripts/indexLaw.ts "LC 123/2006" data/lc_123_2006.txt
echo ""

# 6. Manual TCU (6581 chunks - ~110 min)
echo "📄 [6/6] Indexando Manual TCU..."
pnpm tsx server/scripts/indexLaw.ts "Manual TCU Licitações" data/manual_tcu_5ed.txt
echo ""

# 7. Manual TCE-PR (1116 chunks - ~19 min)
echo "📄 [7/7] Indexando Manual TCE-PR..."
pnpm tsx server/scripts/indexLaw.ts "Manual TCE-PR Licitações" data/manual_tce_pr.txt
echo ""

echo "=========================================="
echo "✅ Reindexação completa finalizada!"
echo "=========================================="
