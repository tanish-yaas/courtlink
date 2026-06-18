import { useEffect, useState } from 'react';
import { Logo } from '../ui/Logo';
import { Panel, Button, ConnectionChip } from '../ui/Primitives';
import { useStore } from '../state/store';
import { setReady } from '../net/socket';
import { buildRoomLink, copyText } from '../ui/roomLink';
import type { Side } from '../shared/types';

export function WaitingRoom() {
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const connection = useStore((s) => s.connection);
  const pingMs = useStore((s) => s.pingMs);
  const setScreen = useStore((s) => s.setScreen);
  const [copied, setCopied] = useState(false);

  // When the server moves the room out of the lobby, drop into the game.
  useEffect(() => {
    if (room && room.phase !== 'lobby') setScreen('game');
  }, [room?.phase, room, setScreen]);

  if (!room) return null;

  const me = room.players.find((p) => p.playerId === playerId);
  const link = buildRoomLink(room.roomId);
  const seated = room.players.filter((p) => p.side);
  const bothSeated = (['A', 'B'] as Side[]).every((s) => seated.some((p) => p.side === s));

  const onCopy = async () => {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const seatLabel = (side: Side | null) => (side ? `TEAM ${side}` : '—');

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 20 }}>
        <Logo />
        <ConnectionChip status={connection} pingMs={pingMs} />
      </div>

      <Panel kicker={`Court ${room.roomId} · Ready Room`}>
        <h1 className="display" style={{ fontSize: 34 }}>
          {bothSeated ? 'Ready up' : 'Waiting for your opponent'}
        </h1>

        <div className="roster">
          {room.players.length === 0 && (
            <div className="roster__row">
              <span className="is-waiting">No players yet</span>
            </div>
          )}
          {room.players.map((p) => (
            <div className="roster__row" key={p.playerId}>
              <span className="roster__left">
                <span className="roster__seat">{seatLabel(p.side)}</span>
                <span className="roster__name">
                  {p.name}
                  {p.playerId === playerId ? ' (You)' : ''}
                </span>
              </span>
              <span className={`roster__state ${p.ready ? 'is-ready' : 'is-waiting'}`}>
                {!p.connected ? 'Disconnected' : p.ready ? 'Ready' : 'Not ready'}
              </span>
            </div>
          ))}
        </div>

        <label className="label" style={{ marginTop: 18 }}>
          Invite your opponent
        </label>
        <div className="share">
          <div className="share__url" title={link}>
            {link}
          </div>
          <Button variant="ghost" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <Button
          variant="primary"
          block
          className="stack-gap"
          disabled={!me?.side || !bothSeated}
          onClick={() => setReady(!me?.ready)}
        >
          {me?.ready ? 'Cancel ready' : bothSeated ? 'I’m ready' : 'Waiting for opponent…'}
        </Button>

        <p className="helper">
          The match starts automatically once both players are ready. Share the link above —
          your opponent joins the same court and picks the open side.
        </p>
      </Panel>
    </div>
  );
}
