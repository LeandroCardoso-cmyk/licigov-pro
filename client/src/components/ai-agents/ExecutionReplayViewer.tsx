import React from "react";

interface Replay { id: string; originalExecutionId: string; replayKey: string; status: string; createdAt: string; }
interface Props { replays?: Replay[]; onReplay?: (id: string) => void; }

export function ExecutionReplayViewer({ replays = [], onReplay }: Props) {
  return (
    <div>
      <h4>Replay de Execuções</h4>
      {replays.length === 0 && <p>Sem replays disponíveis.</p>}
      {replays.map(r => (
        <div key={r.id} style={{ border: "1px solid #333", padding: 8, marginBottom: 8 }}>
          <p>Execução original: <code>{r.originalExecutionId}</code></p>
          <p>Replay key: <code style={{ fontSize: 10 }}>{r.replayKey.slice(0, 20)}...</code></p>
          <p>Status: {r.status}</p>
          <button onClick={() => onReplay?.(r.id)}>Replay</button>
        </div>
      ))}
    </div>
  );
}
