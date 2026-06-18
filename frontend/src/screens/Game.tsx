import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, mySide as getMySide } from '../state/store';
import { useGameLoop } from '../game/useGameLoop';
import { HUD } from '../ui/HUD';
import { ConnectionChip } from '../ui/Primitives';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { CountdownOverlay, PauseOverlay, MatchOverOverlay } from './Overlays';
import type { Side } from '../shared/types';

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const room = useStore((s) => s.room);
  const snapshot = useStore((s) => s.snapshot);
  const playerId = useStore((s) => s.playerId);
  const connection = useStore((s) => s.connection);
  const pingMs = useStore((s) => s.pingMs);
  const toast = useStore((s) => s.toast);

  const [side, setSide] = useState<Side | null>(null);
  useEffect(() => setSide(getMySide()), [room, playerId]);

  const touch = useMemo(() => isTouchDevice(), []);
  useGameLoop(canvasRef, side, !!room);

  if (!room) return null;

  const phase = snapshot?.phase ?? room.phase;
  const score = snapshot?.score ?? null;
  const amServer = score?.serving === side;
  const canServe = phase === 'serving' && amServer;

  const hint = (() => {
    if (phase === 'serving') {
      return amServer ? 'Your serve — press Space / Serve' : 'Opponent to serve';
    }
    if (phase === 'rally') return 'Move: WASD / Arrows · Hit: Space';
    return '';
  })();

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game__canvas" />

      <HUD room={room} score={score} myPlayerId={playerId} toast={toast} />

      <div className="statuses">
        <ConnectionChip status={connection} pingMs={pingMs} />
      </div>

      {hint && <div className="hint">{hint}</div>}

      {touch && (phase === 'rally' || phase === 'serving') && (
        <TouchControls canServe={canServe} />
      )}

      {phase === 'countdown' && <CountdownOverlay n={snapshot?.countdown ?? 3} />}
      {phase === 'paused' && <PauseOverlay room={room} />}
      {phase === 'matchOver' && (
        <MatchOverOverlay room={room} score={score} myPlayerId={playerId} />
      )}
    </div>
  );
}
