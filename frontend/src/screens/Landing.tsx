import { Logo } from '../ui/Logo';
import { Button, Panel, ConnectionChip } from '../ui/Primitives';
import { useStore } from '../state/store';

export function Landing() {
  const setScreen = useStore((s) => s.setScreen);
  const connection = useStore((s) => s.connection);
  const pingMs = useStore((s) => s.pingMs);

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 20 }}>
        <Logo />
        <ConnectionChip status={connection} pingMs={pingMs} />
      </div>

      <Panel kicker="Center Court · Live">
        <h1 className="display">
          The club court, <em>reimagined</em> for the browser.
        </h1>
        <p className="lede">
          Spin up a private court, share one link, and rally in real time from any two
          devices. Traditional pickleball scoring, the two-bounce rule, and the kitchen —
          all refereed by an authoritative server.
        </p>

        <div className="btn-row">
          <Button variant="primary" block onClick={() => setScreen('create')}>
            Create Match
          </Button>
          <Button variant="ghost" block onClick={() => setScreen('join')}>
            Join Match
          </Button>
        </div>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <Button variant="ghost" block onClick={() => setScreen('solo')}>
            Play vs Computer
          </Button>
        </div>

        <p className="helper">
          Singles, games to 11, win by 2. Built server-authoritative so both players see the
          same call.
        </p>
      </Panel>
    </div>
  );
}
