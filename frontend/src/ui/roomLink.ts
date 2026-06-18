/**
 * Share-link helpers.
 *
 * We encode the room in the URL hash (`/#room=ABC123`) rather than the path or
 * query string. The hash is ideal for static hosts (Vercel, GitHub Pages):
 * it never triggers a server round-trip and survives SPA hosting without any
 * rewrite rules. The second device just opens the link and we auto-fill join.
 */
export function buildRoomLink(roomId: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#room=${encodeURIComponent(roomId)}`;
}

export function parseRoomFromHash(): string | null {
  const m = window.location.hash.match(/room=([A-Za-z0-9]+)/);
  return m ? m[1].toUpperCase() : null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older / insecure contexts.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}
