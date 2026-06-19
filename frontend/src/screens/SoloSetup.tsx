import { useState } from 'react';
import { Logo } from '../ui/Logo';
import { Button, Panel } from '../ui/Primitives';
import { useStore } from '../state/store';
import { startSolo } from '../game/solo';
import type { Difficulty } from '../game/ai';

const LEVELS: { id: Difficulty; name: string; blurb: string }[] = [
  { id: 'easy', name: 'Easy', blurb: 'Gentle pace, generous misses — a relaxed warm-up.' },
  { id: 'medium', name: 'Medium', blurb: 'Moves well, returns most balls, places shots.' },
  { id: 'hard', name: 'Hard', blurb: 'Fast, accurate, hunts your open court. Bring it.' },
];

export function SoloSetup() {
  const setScreen = useStore((s) => s.setScreen);
  const [picked, setPicked] = useState<Difficulty>('medium');

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 20 }}>
        <Logo />
      </div>

      <Panel kicker="Solo · vs Computer">
        <h1 className="display">
          Practice court, <em>against the machine.</em>
        </h1>
        <p className="lede">
          Same rules, same court — a computer opponent that genuinely chases the ball,
          honours the two-bounce rule, and aims for your open court. Pick your level.
        </p>

        <div className="levels">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className={`level ${picked === l.id ? 'level--on' : ''}`}
              onClick={() => setPicked(l.id)}
            >
              <span className="level__name">{l.name}</span>
              <span className="level__blurb">{l.blurb}</span>
            </button>
          ))}
        </div>

        <div className="btn-row">
          <Button variant="primary" block onClick={() => startSolo(picked)}>
            Start Match
          </Button>
          <Button variant="ghost" block onClick={() => setScreen('landing')}>
            Back
          </Button>
        </div>

        <p className="helper">
          You're Team A at the bottom. Swipe your paddle through the ball to hit; flick
          forward to serve.
        </p>
      </Panel>
    </div>
  );
}
