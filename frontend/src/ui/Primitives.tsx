import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { ConnectionStatus } from '../state/store';

type Variant = 'primary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
}

export function Button({ variant = 'ghost', block, className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`btn btn--${variant}${block ? ' btn--block' : ''} ${className}`.trim()}
      {...rest}
    />
  );
}

export function Panel({ children, kicker }: { children: ReactNode; kicker?: string }) {
  return (
    <div className="panel">
      {kicker && <p className="panel__kicker">{kicker}</p>}
      {children}
    </div>
  );
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  connected: 'Live',
  reconnecting: 'Reconnecting',
  error: 'Error',
};

export function ConnectionChip({
  status,
  pingMs,
}: {
  status: ConnectionStatus;
  pingMs?: number | null;
}) {
  return (
    <span className="chip">
      <span className={`dot dot--${status}`} />
      {STATUS_LABEL[status]}
      {status === 'connected' && pingMs != null && <span>· {pingMs}ms</span>}
    </span>
  );
}
