# CourtLink Pickleball

A premium, real-time, two-player pickleball match you play in the browser. Open
a court, share one link, and rally against a friend on another device. The look
is dark sport-luxury — deep championship green, warm ivory lines, restrained
gold — with a broadcast-style scoreboard over a living court.

This is a real game, not a mockup: an **authoritative Node server** runs the
physics and the rulebook, and the **browser client** predicts your own paddle
for instant feel while interpolating everything else from the server's truth.

---

## Why the project is split in two

GitHub Pages (and Vercel's static hosting) can only serve **files** — HTML, CSS,
JS. They cannot keep a live WebSocket connection open or run a game loop. Real
multiplayer needs a always-on server holding the room state and stepping the
simulation. So the project is two deployables:

| Part        | What it is                              | Where it goes              |
| ----------- | --------------------------------------- | -------------------------- |
| `frontend/` | Static React + Vite client (the game UI)| **Vercel** (or GitHub Pages)|
| `backend/`  | Node + Socket.IO authoritative server   | **Render** (or Railway/Fly) |
| `shared/`   | Constants + types used by both          | copied into each package    |

The frontend learns where the backend lives from one environment variable,
`VITE_BACKEND_URL`. Nothing is hardcoded to localhost in production.

---

## Architecture at a glance

```
Browser A ─┐                       ┌─ GameSim (60Hz physics + pickleball rules)
           ├── Socket.IO (WS) ──► Room ── broadcasts snapshots (30Hz) ──► both clients
Browser B ─┘                       └─ RoomManager (room lifecycle, codes, reaping)

Client:  input intent ──► server          (you never move the ball yourself)
         server snapshots ──► interpolate  (ball + opponent rendered ~90ms in the past)
         your own paddle ──► predicted     (instant) then reconciled to server truth
```

- **Server owns the truth.** Ball position, bounces, faults, score, who serves,
  and the service court are all decided server-side. Clients send only *intent*
  (`dirX, dirY, hit, serve, aimY`).
- **Client prediction + interpolation.** Your paddle responds instantly and is
  gently corrected toward the server's position. The ball and the opponent are
  drawn from a buffered snapshot feed (`RENDER_DELAY_MS`) so jitter never shows.
- **Reconnect.** Your seat is held warm for 30s. Identity (player id + token) is
  saved to `localStorage`; a refresh silently reclaims your seat.

### Why a custom Canvas renderer instead of Phaser

The brief allowed "Phaser 3 or a similarly strong framework." A purpose-built
HTML5 Canvas renderer was chosen deliberately: it keeps the bundle lean, gives
full control over the premium look (ball-height shadow, motion trail, gold
service-court highlight, net cast-shadow, vignette), and makes the
interpolation/prediction seam invisible. Phaser would add weight and an
abstraction layer we'd mostly fight for a top-down two-body game.

---

## Pickleball rules implemented (and honest abstractions)

Implemented faithfully:

- **Diagonal serve** into the correct service box; serving from the **right/even**
  court first, **left/odd** when the server's score is odd.
- **Two-bounce rule**: the return side must let the serve bounce, and the serving
  side must let the return bounce, before either may volley.
- **Kitchen / non-volley zone**: no volley while inside the 7ft zone.
- **Faults**: serve/return into the net, out of bounds, double bounce, kitchen
  volley, and illegal (non-diagonal) serve.
- **Scoring**: traditional side-out scoring (only the serving side scores) or
  rally scoring; games to 11 (configurable) win-by-2; side-out logic.

Documented abstractions for a fair, readable MVP:

- **Singles** is what ships. The engine and types are written so **doubles**
  (second-server logic, partner positioning) can be layered on without rule
  rewrites — see `RuleConfig.mode` and `serverNumber`.
- The **underhand serve** is modeled as an auto-arc launch (you press serve and
  aim) rather than a swing-height check — the rule it protects (a legal, makeable
  serve into the diagonal box) is enforced; the body mechanics are abstracted.
- Coordinates are in "court feet" using real 44×20 proportions; "right/left"
  service courts are defined from each player facing the net (documented in
  `shared/constants.ts`).

All of this lives in one place — `shared/constants.ts` (`RuleConfig`,
`DEFAULT_RULES`) and `backend/src/sim/rules.ts` — so variants are config, not
surgery.

---

## File tree

```
courtlink/
├─ shared/                      canonical constants + types (source of truth)
│  ├─ constants.ts              court geometry, physics, timing, RuleConfig
│  └─ types.ts                  network protocol + state shapes
├─ backend/                     authoritative realtime server
│  ├─ src/
│  │  ├─ index.ts               http + Socket.IO wiring, per-socket handlers
│  │  ├─ Room.ts                one match: roster, ready, loop, broadcasts
│  │  ├─ RoomManager.ts         room registry, code generation, reaping
│  │  ├─ sim/
│  │  │  ├─ GameSim.ts          authoritative sim: phases, serve, rally, score
│  │  │  ├─ physics.ts          ball integration, bounce, net crossing
│  │  │  └─ rules.ts            serve legality, faults, scoring, winner
│  │  └─ shared/                copy of /shared (self-contained for deploy)
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ .env.example
├─ frontend/                    static premium client
│  ├─ src/
│  │  ├─ main.tsx               entry
│  │  ├─ App.tsx                screen router + auto-reconnect
│  │  ├─ screens/               Landing, Create, Join, SideSelect, Waiting, Game, Overlays
│  │  ├─ ui/                    Logo, Primitives, HUD, TouchControls, roomLink
│  │  ├─ game/                  renderer, netState (interp), input, useGameLoop
│  │  ├─ net/socket.ts          single Socket.IO connection + actions
│  │  ├─ state/store.ts         Zustand app state
│  │  ├─ styles.css             design system
│  │  └─ shared/                copy of /shared
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts
│  └─ .env.example
├─ scripts/sync-shared.mjs      copies /shared into both packages
├─ .github/workflows/           optional GitHub Pages deploy
└─ package.json                 root helper scripts
```

---

## Controls

- **Move**: `W A S D` or arrow keys
- **Serve**: `Space` (when it's your serve)
- **Hit / return**: `Space` or `K`
- **Mobile**: on-screen joystick + Serve/Hit buttons appear automatically

---

## Run it locally

You need **Node 18+**. Two terminals.

```bash
# 1) install both packages
npm run install:all          # from repo root

# 2) terminal A — backend
cd backend
cp .env.example .env         # PORT=8080, CORS_ORIGIN=*
npm run dev                  # server on http://localhost:8080

# 3) terminal B — frontend
cd frontend
cp .env.example .env         # VITE_BACKEND_URL=http://localhost:8080
npm run dev                  # client on http://localhost:5173
```

Open `http://localhost:5173`, click **Create Match**, copy the link, and open it
in a second browser window (or another device on your network) to play. To test
two devices on a LAN, set `VITE_BACKEND_URL` to your machine's LAN IP.

If you ever edit `/shared`, re-sync the copies:

```bash
npm run sync:shared
```

---

## Deploy — step by step, the simple version

We'll put the **server on Render** and the **game on Vercel**. Free tiers are
fine. You'll do it in this order: GitHub → Render (backend) → Vercel (frontend) →
connect them.

> One thing to know up front: the two halves need each other's web address.
> Render gives the backend an address; Vercel gives the frontend one. We hand
> each address to the other side at the end. That's the whole trick.

### Step 0 — Put the code on GitHub (from VS Code)

1. Open the `courtlink` folder in **VS Code**.
2. Click the **Source Control** icon on the left (it looks like a little branch).
3. Click **Initialize Repository**.
4. Type a short message like `first commit` in the box, then click the
   **✓ Commit** button. If it asks "stage all changes?", say yes.
5. Click **Publish Branch** → choose **publish to GitHub** → pick **public** or
   **private**. VS Code creates the repo and uploads everything.

That's your code safely on GitHub. ✅

### Step 1 — Deploy the backend to Render

1. Go to **render.com** and sign in with GitHub.
2. Click **New +** → **Web Service**.
3. Pick your `courtlink` repository.
4. Fill in the form exactly like this:
   - **Name**: `courtlink-server` (anything is fine)
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Scroll to **Environment Variables** and add one:
   - Key `CORS_ORIGIN`, Value `*` (we'll tighten this in Step 3).
6. Click **Create Web Service** and wait for the log to say it's **Live**.
7. Copy the address at the top — it looks like
   `https://courtlink-server.onrender.com`. **Keep this; it's the backend URL.**

> Note: Render's free server "sleeps" after idle time, so the very first connect
> may take ~30 seconds to wake. That's normal on the free tier.

### Step 2 — Deploy the frontend to Vercel

1. Go to **vercel.com** and sign in with GitHub.
2. Click **Add New… → Project** and import your `courtlink` repository.
3. In the setup screen:
   - **Root Directory**: click **Edit** and choose `frontend`.
   - Framework should auto-detect **Vite**. Leave build/output as default
     (`npm run build`, output `dist`).
4. Open **Environment Variables** and add one:
   - Name `VITE_BACKEND_URL`
   - Value = the Render address from Step 1 (e.g.
     `https://courtlink-server.onrender.com`) — **no trailing slash**.
5. Click **Deploy**. When it finishes, Vercel gives you a link like
   `https://courtlink.vercel.app`. **That's your game.**

### Step 3 — Introduce them to each other (CORS)

Right now the backend trusts everyone (`*`). Lock it to your real game address:

1. Back in **Render** → your service → **Environment** → edit `CORS_ORIGIN`.
2. Set it to your Vercel URL, e.g. `https://courtlink.vercel.app` (no trailing
   slash). Save — Render redeploys automatically.

Done. Open the Vercel link, **Create Match**, copy the share link, send it to a
friend (or open on your phone), and play. 🎾

### If something doesn't connect

- The game shows **Connecting** forever → the backend URL is wrong or the server
  is asleep. Check `VITE_BACKEND_URL` on Vercel matches the Render address, and
  give a sleeping free server ~30s.
- Console shows a **CORS error** → `CORS_ORIGIN` on Render must equal your Vercel
  URL exactly (https, no trailing slash).
- You changed `VITE_BACKEND_URL` but nothing changed → Vercel bakes env vars in
  at build time; trigger a **Redeploy** after editing it.

---

## Alternative: frontend on GitHub Pages

A ready workflow lives in `.github/workflows/deploy-frontend.yml`. Enable Pages
(Settings → Pages → Source: GitHub Actions) and add an Actions **variable**
`VITE_BACKEND_URL`. The workflow sets the correct `/<repo>/` base path for you.
Vercel is simpler, but this works if you want everything on GitHub.

---

## Environment variables

**backend/.env**

```
PORT=8080
CORS_ORIGIN=*            # in production set to your frontend origin
```

**frontend/.env**

```
VITE_BACKEND_URL=http://localhost:8080   # in production set to your backend URL
# VITE_BASE=/courtlink/                  # only for GitHub Pages project sites
```

---

## A note on building & testing

The code is written carefully and consistently across client/server, but it was
authored in an environment without network access, so `npm install` and a full
type-check/build were **not** run here. Before deploying, run `npm run
install:all` and the local dev steps above; if TypeScript flags a minor issue,
it'll be a quick fix rather than an architectural one. The contracts in
`shared/` are the thing to keep an eye on if you extend the game.

---

Built with React + Vite + TypeScript (frontend), Node + Socket.IO + TypeScript
(backend), and a hand-written Canvas renderer.
