import React from "react";

interface ReplayRecord { snapshotKey: string; originalExecutionId: string; createdAt: string; }
interface Props { replays: ReplayRecord[]; organizationId: number; onReplay?: (snapshotKey: string) => void; }

export function ProviderReplayViewer({ replays, organizationId, onReplay }: Props) {
  return (
    <div data-testid="replay-viewer">
      <h3>Replay History — Org {organizationId}</h3>
      <div>Total Replays: {replays.length}</div>
      {replays.map(r => (
        <div key={r.snapshotKey} data-testid={`replay-${r.snapshotKey.slice(0, 8)}`}>
          <span>Original: {r.originalExecutionId}</span>
          <span>{r.createdAt}</span>
          {onReplay && <button onClick={() => onReplay(r.snapshotKey)}>Replay</button>}
        </div>
      ))}
    </div>
  );
}
