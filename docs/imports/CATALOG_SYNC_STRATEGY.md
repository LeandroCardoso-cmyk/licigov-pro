# Catalog Sync Strategy — CATMAT Integration, Versioning & Future Roadmap

## Current State (Sprint 2.95)

In this sprint, the catalog synchronization domain provides the **data structures and
interfaces** for future CATMAT/CATSER integration. No live API calls are made.

Key structures implemented:
- `CatalogSnapshot` — versioned point-in-time snapshot of a catalog
- `CatalogSyncHistory` — immutable audit log of sync operations
- `IntegrityMetadata` — checksum-based integrity verification
- `CacheMetadata` — TTL-based staleness tracking

## Catalog Types

| Type | Description |
|------|-------------|
| `catmat` | Catálogo de Materiais (COMPRAS.GOV.BR) — standardized material codes |
| `catser` | Catálogo de Serviços (COMPRAS.GOV.BR) — standardized service codes |
| `custom` | Organization-specific custom catalog entries |

## Versioning Strategy

Each snapshot carries a `version` string and `snapshotLineage` (previous snapshot id).
This creates a linked chain of snapshots, enabling:
- Rollback to any previous version
- Diff between versions
- Audit trail of all catalog changes

## Checksum-Based Integrity

`computeChecksum(content)` uses SHA-256 to verify catalog data integrity:
- Computed on import
- Re-verified on access via `verifyIntegrity()`
- `integrityMetadata.isValid = false` triggers re-sync on next access

## Cache TTL

Default TTL: 24 hours (configurable via `params.ttlMs`)
- `isSnapshotStale(snapshot, maxAgeMs)` checks actual expiry time
- `markStale(snapshot)` forces stale status (returns new snapshot — immutable)

## Sync Operations

| Operation | Trigger | Description |
|-----------|---------|-------------|
| `create` | First sync | Initial population of catalog snapshot |
| `update` | New version available | Replace entries with new version |
| `verify` | Scheduled check | Re-verify integrity without update |
| `invalidate` | Integrity failure | Mark data as invalid, force re-sync |
| `expire` | TTL exceeded | Mark as stale due to time |

## Future Roadmap (Post Sprint 2.95)

1. **API Integration**: Connect to COMPRAS.GOV.BR CATMAT/CATSER REST API
2. **Delta Sync**: Only sync changed entries (using version comparison)
3. **Background Sync**: Scheduled nightly sync via job queue
4. **Cross-Org Sharing**: Allow organizations to share custom catalog entries
5. **CATMAT Code Validation**: Real-time validation of catmatCode against live catalog
6. **Webhook Support**: Receive push notifications when CATMAT is updated

## sourceUrl Field

Currently always `null`. Will be populated with the API endpoint URL when live
integration is implemented (e.g., `https://compras.dados.gov.br/licitacoes/v1/...`).
