import { Logo } from '../ui/Logo';
import { Panel, Button, ConnectionChip } from '../ui/Primitives';
import { useStore } from '../state/store';
import { selectSide } from '../net/socket';
import type { Side } from '../shared/types';

export function SideSelect() {
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const connection = useStore((s) => s.connection);
  const setScreen = useStore((s) => s.setScreen);

  if (!room) {
    return (
      <div className="screen">
        <Panel kicker="Connecting">
          <div className="spinner" />
          <p className="lede" style={{ textAlign: 'center', margin: 0 }}>
            Reaching the court…
          </p>
        </Panel>
      </div>
    );
  }

  const occupant = (side: Side) => room.players.find((p) => p.side === side);
  const mine = room.players.find((p) => p.playerId === playerId)?.side ?? null;

  const choose = (side: Side) => {
    const taken = occupant(side);
    if (taken && taken.playerId !== playerId) return;
    selectSide(side);
    // Advance once we hold a seat; room:state will confirm.
    setTimeout(() => setScreen('waiting'), 120);
  };

  const card = (side: Side, label: string, swatch: string) => {
    const who = occupant(side);
    const isMine = mine === side;
    const takenByOther = who && who.playerId !== playerId;
    return (
      <button
        className="side-card"
        data-selected={isMine}
        disabled={!!takenByOther}
        onClick={() => choose(side)}
      >
        <span className="side-card__swatch" style={{ background: swatch }} />
        <span className="side-card__tag">{side === 'A' ? 'Left baseline' : 'Right baseline'}</span>
        <div className="side-card__name">{label}</div>
        <div className="side-card__who">
          {who ? (who.playerId === playerId ? 'You' : who.name) : 'Open seat'}
        </div>
      </button>
    );
  };

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 20 }}>
        <Logo />
        <ConnectionChip status={connection} pingMs={useStore.getState().pingMs} />
      </div>

      <Panel kicker={`Court ${room.roomId} · Choose Side`}>
        <h1 className="display" style={{ fontSize: 34 }}>
          Pick your side
        </h1>
        <div className="sides">
          {card('A', 'Team A', '#F3EAD8')}
          {card('B', 'Team B', '#C8A24B')}
        </div>
        <Button variant="ghost" block disabled={!mine} onClick={() => setScreen('waiting')}>
          Continue to ready room
        </Button>
      </Panel>
    </div>
  );
}
