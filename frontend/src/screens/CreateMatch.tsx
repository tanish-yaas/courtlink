import { useState } from 'react';
import { Logo } from '../ui/Logo';
import { Button, Panel } from '../ui/Primitives';
import { useStore } from '../state/store';
import { createRoom } from '../net/socket';
import { DEFAULT_RULES } from '../shared/constants';

export function CreateMatch() {
  const setScreen = useStore((s) => s.setScreen);
  const error = useStore((s) => s.error);
  const [name, setName] = useState('');
  const [scoring, setScoring] = useState(DEFAULT_RULES.scoring);
  const [pointsToWin, setPointsToWin] = useState(DEFAULT_RULES.pointsToWin);

  const submit = () => {
    if (!name.trim()) return;
    createRoom(name.trim(), { scoring, pointsToWin });
  };

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 20 }}>
        <Logo />
        <button className="link-btn" onClick={() => setScreen('landing')}>
          ← Back
        </button>
      </div>

      <Panel kicker="Create · New Court">
        <h1 className="display" style={{ fontSize: 36 }}>
          Open a court
        </h1>

        <div className="field">
          <label className="label">Your name</label>
          <input
            className="input"
            placeholder="e.g. Alex"
            value={name}
            maxLength={18}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
          />
        </div>

        <label className="label">Scoring</label>
        <div className="rules">
          <label className="toggle">
            Traditional
            <input
              type="radio"
              name="scoring"
              checked={scoring === 'traditional'}
              onChange={() => setScoring('traditional')}
            />
          </label>
          <label className="toggle">
            Rally
            <input
              type="radio"
              name="scoring"
              checked={scoring === 'rally'}
              onChange={() => setScoring('rally')}
            />
          </label>
        </div>

        <label className="label" style={{ marginTop: 14 }}>
          Game to
        </label>
        <div className="rules">
          {[11, 15, 21].map((n) => (
            <label className="toggle" key={n}>
              {n} points
              <input
                type="radio"
                name="points"
                checked={pointsToWin === n}
                onChange={() => setPointsToWin(n)}
              />
            </label>
          ))}
        </div>

        <Button
          variant="primary"
          block
          className="stack-gap"
          disabled={!name.trim()}
          onClick={submit}
        >
          Create &amp; Get Link
        </Button>

        {error && <p className="error-text">{error}</p>}
      </Panel>
    </div>
  );
}
