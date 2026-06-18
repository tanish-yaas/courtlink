/**
 * HUD — the broadcast-grade overlay drawn above the live court.
 *
 * Shows both teams' scores, who is serving (gold bar + role line), the room
 * code for late joiners, the active service court, and transient fault/point
 * toasts. Reads purely from the store's latest snapshot/room state.
 */
import type { RoomState, ScoreState } from '../shared/types';
import type { Toast } from '../state/store';

interface HudProps {
  room: RoomState;
  score: ScoreState | null;
  myPlayerId: string | null;
  toast: Toast | null;
}

const TEAM_COLOR: Record<'A' | 'B', string> = { A: '#F3EAD8', B: '#C8A24B' };

export function HUD({ room, score, myPlayerId, toast }: HudProps) {
  const nameFor = (side: 'A' | 'B') => {
    const p = room.players.find((q) => q.side === side);
    if (!p) return 'Open';
    return p.playerId === myPlayerId ? `${p.name} (You)` : p.name;
  };

  const serving = score?.serving ?? null;
  const a = score?.A ?? 0;
  const b = score?.B ?? 0;

  return (
    <>
      <div className="hud">
        <TeamCell side="A" name={nameFor('A')} score={a} serving={serving === 'A'} />
        <div className="hud__center">
          <div className="hud__code">{room.roomId}</div>
          <div className="hud__court">
            {score ? `${score.serviceCourt} court` : `to ${room.rules.pointsToWin}`}
          </div>
        </div>
        <TeamCell side="B" name={nameFor('B')} score={b} serving={serving === 'B'} />
      </div>

      {toast && (
        <div className={`toast toast--${toast.tone}`} key={toast.id}>
          {toast.text}
        </div>
      )}
    </>
  );
}

function TeamCell({
  side,
  name,
  score,
  serving,
}: {
  side: 'A' | 'B';
  name: string;
  score: number;
  serving: boolean;
}) {
  return (
    <div className="hud__team" data-serving={serving}>
      <span className="hud__bar" style={{ background: TEAM_COLOR[side] }} />
      <span className="hud__meta">
        <span className="hud__name">{name}</span>
        <span className="hud__role">{serving ? 'Serving' : `Team ${side}`}</span>
      </span>
      <span className="hud__score">{score}</span>
    </div>
  );
}
