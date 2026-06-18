import { useEffect, useState } from 'react';
import { Logo } from '../ui/Logo';
import { Button, Panel } from '../ui/Primitives';
import { useStore } from '../state/store';
import { joinRoom } from '../net/socket';
import { parseRoomFromHash } from '../ui/roomLink';
import { ROOM_CODE_LENGTH } from '../shared/constants';

export function JoinMatch() {
  const setScreen = useStore((s) => s.setScreen);
  const error = useStore((s) => s.error);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // If we arrived via a share link, pre-fill the room code.
  useEffect(() => {
    const fromLink = parseRoomFromHash();
    if (fromLink) setCode(fromLink);
  }, []);

  const valid = name.trim().length > 0 && code.trim().length === ROOM_CODE_LENGTH;
  const submit = () => {
    if (!valid) return;
    joinRoom(code.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 20 }}>
        <Logo />
        <button className="link-btn" onClick={() => setScreen('landing')}>
          ← Back
        </button>
      </div>

      <Panel kicker="Join · Enter Court">
        <h1 className="display" style={{ fontSize: 36 }}>
          Join a court
        </h1>

        <div className="field">
          <label className="label">Your name</label>
          <input
            className="input"
            placeholder="e.g. Sam"
            value={name}
            maxLength={18}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!code}
          />
        </div>

        <div className="field">
          <label className="label">Room code</label>
          <input
            className="input input--code"
            placeholder="••••••"
            value={code}
            maxLength={ROOM_CODE_LENGTH}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus={!!code}
          />
        </div>

        <Button variant="primary" block disabled={!valid} onClick={submit}>
          Join Court
        </Button>

        {error && <p className="error-text">{error}</p>}
      </Panel>
    </div>
  );
}
