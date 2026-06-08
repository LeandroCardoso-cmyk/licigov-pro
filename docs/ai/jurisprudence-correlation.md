# Jurisprudence Correlation

## Overview
Links procurement documents and AI reasoning traces to relevant TCU, STJ, and STF rulings, building a citation graph that surfaces binding and persuasive precedents.

## Core Concepts
- **JurisprudenceReference**: a court decision with metadata (court, number, date, summary, binding status)
- **PrecedentHierarchyNode**: tree node for organising precedents by legal theme
- **LegalCitation**: a directed link from a document or trace to a reference

## Key Functions
| Function | Purpose |
|---|---|
| `createJurisprudenceReferenceV2` | Registers a court decision |
| `findRelevantPrecedentsV2` | Retrieves precedents matching a legal question |
| `rankPrecedentsByRelevanceV2` | Orders results by binding force and similarity |
| `buildCitationGraphV2` | Builds a directed graph of citation relationships |
| `formatCitationV2` | Formats a citation string per ABNT/TCU style |

## Precedent Hierarchy
`binding (STF/TCU súmula) > persuasive (acórdão) > informative (parecer)`

## Storage
Tables: `jurisprudence_references`, `jurisprudence_correlations` — see drizzle/0156 and 0157.
