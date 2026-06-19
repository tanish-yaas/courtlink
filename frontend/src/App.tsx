import { useEffect } from 'react';
import { useStore } from './state/store';
import { tryAutoReconnect } from './net/socket';
import { parseRoomFromHash } from './ui/roomLink';
import { Landing } from './screens/Landing';
import { SoloSetup } from './screens/SoloSetup';
import { CreateMatch } from './screens/CreateMatch';
import { JoinMatch } from './screens/JoinMatch';
import { SideSelect } from './screens/SideSelect';
import { WaitingRoom } from './screens/WaitingRoom';
import { Game } from './screens/Game';

export default function App() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);

  useEffect(() => {
    // Recover a prior seat (refresh / accidental close) if we have identity.
    tryAutoReconnect();
    // If opened via a share link and we have no session, head to Join (prefilled).
    const fromLink = parseRoomFromHash();
    if (fromLink && useStore.getState().screen === 'landing') {
      setScreen('join');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  switch (screen) {
    case 'solo':
      return <SoloSetup />;
    case 'create':
      return <CreateMatch />;
    case 'join':
      return <JoinMatch />;
    case 'side':
      return <SideSelect />;
    case 'waiting':
      return <WaitingRoom />;
    case 'game':
      return <Game />;
    case 'landing':
    default:
      return <Landing />;
  }
}
