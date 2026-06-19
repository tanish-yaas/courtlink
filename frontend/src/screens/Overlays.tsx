import { Button } from '../ui/Primitives';
import { useStore } from '../state/store';
import { rematch, leaveRoom } from '../net/socket';
import { soloActive } from '../game/solo';
import type { RoomState, ScoreState } from '../shared/types';

export function CountdownOverlay({ n }: { n: number }) {
  return (
    <div className="overlay">
      <div className="overlay__card">
        <p className="panel__kicker">Get ready</p>
        <div className="countdown">{n > 0 ? n : 'Go'}</div>
      </div>
    </div>
  );
}

export function PauseOverlay({ room }: { room: RoomState }) {
  const dropped = room.players.find((p) => !p.connected);
  return (
    <div className="overlay">
      <div className="overlay__card">
        <div className="spinner" />
        <h2 className="overlay__title" style={{ fontSize: 40 }}>
          Match paused
        </h2>
        <p className="overlay__sub">
          {dropped
            ? `Waiting for ${dropped.name} to reconnect…`
            : 'Waiting for both players…'}
        </p>
        <Button variant="ghost" onClick={leaveRoom}>
          Leave court
        </Button>
      </div>
    </div>
  );
}

export function MatchOverOverlay({
  room,
  score,
  myPlayerId,
}: {
  room: RoomState;
  score: ScoreState | null;
  myPlayerId: string | null;
}) {
  const setScreen = useStore((s) => s.setScreen);
  if (!score) return null;
  const winner = score.A > score.B ? 'A' : 'B';
  const winnerName = room.players.find((p) => p.side === winner)?.name ?? `Team ${winner}`;
  const mySide = room.players.find((p) => p.playerId === myPlayerId)?.side ?? null;
  const iWon = mySide === winner;

  const onRematch = () => {
    rematch();
    if (!soloActive()) setScreen('waiting');
  };

  return (
    <div className="overlay">
      <div className="overlay__card">
        <p className="panel__kicker">{iWon ? 'Victory' : 'Match complete'}</p>
        <h2 className="overlay__title">
          {iWon ? (
            <>
              <em>You</em> win
            </>
          ) : (
            <>
              {winnerName} <em>wins</em>
            </>
          )}
        </h2>
        <p className="overlay__sub">
          Final · {score.A} – {score.B}
        </p>
        <div className="btn-row" style={{ maxWidth: 360, margin: '0 auto' }}>
          <Button variant="primary" block onClick={onRematch}>
            Rematch
          </Button>
          <Button variant="ghost" block onClick={leaveRoom}>
            Leave
          </Button>
        </div>
      </div>
    </div>
  );
}
