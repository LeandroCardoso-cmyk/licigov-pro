# Document Drafting Engine

## Overview
Generates, resolves, and validates procurement documents (editais, contratos, atas) from reusable templates with variable substitution and AI-assisted clause generation.

## Core Concepts
- **Template**: versioned skeleton with typed variable slots and ordered sections
- **Section**: logical block (intro, objeto, habilitação, …) with content and ordering
- **Generation**: a resolved, point-in-time instance of a template bound to a specific procurement

## Key Functions
| Function | Purpose |
|---|---|
| `createDraftTemplateV2` | Creates a versioned document template |
| `createDraftSectionV2` | Adds a named section to a template |
| `createDraftVariableV2` | Declares a typed variable slot |
| `resolveDraftVariables` | Substitutes variables with procurement-specific values |
| `generateDraftV2` | Produces a complete draft document |
| `validateDraftCompletenessV2` | Checks that all required variables are filled |
| `extractTemplateSkeleton` | Returns the bare structure without content |

## Storage
Tables: `draft_templates`, `draft_sections`, `draft_generations` — see drizzle/0150-0152.
