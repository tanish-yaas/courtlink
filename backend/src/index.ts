/**
 * CourtLink Pickleball — realtime server entry point.
 *
 * Plain Node http server + Socket.IO. No database: rooms are in-memory, which
 * is exactly right for ephemeral match rooms. Deploy this to a realtime-
 * friendly host (Render / Railway / Fly). GitHub Pages and Vercel static
 * hosting CANNOT run this — they serve files, not long-lived sockets.
 */
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import {
  NetEvents,
  type CreateRoomReq,
  type InputReq,
  type JoinRoomAck,
  type JoinRoomReq,
  type ReadyReq,
  type SelectSideReq,
  type ConfigureReq,
} from './shared/types';
import { RoomManager } from './RoomManager';

const PORT = Number(process.env.PORT) || 8080;
// Comma-separated list of allowed web origins, e.g.
//   CORS_ORIGIN=https://your-app.vercel.app,http://localhost:5173
const ORIGINS = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim());

const http = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'courtlink-server' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(http, {
  cors: { origin: ORIGINS.includes('*') ? '*' : ORIGINS, methods: ['GET', 'POST'] },
});

const manager = new RoomManager(io);
setInterval(() => manager.reap(), 15_000);

io.on('connection', (socket) => {
  // We remember which (room, player) this socket belongs to for disconnects.
  let boundRoomId: string | null = null;
  let boundPlayerId: string | null = null;

  socket.on(NetEvents.CreateRoom, (req: CreateRoomReq, ack: (a: JoinRoomAck) => void) => {
    const room = manager.create(req?.rules);
    const playerId = randomUUID();
    const token = randomUUID();
    socket.join(room.id);
    room.addOrReconnect({ playerId, token, name: req?.name ?? 'Host', socketId: socket.id });
    boundRoomId = room.id;
    boundPlayerId = playerId;
    ack?.({ ok: true, roomId: room.id, playerId, token, isHost: true });
  });

  socket.on(NetEvents.JoinRoom, (req: JoinRoomReq, ack: (a: JoinRoomAck) => void) => {
    const room = manager.get(req.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });
    const playerId = req.playerId ?? randomUUID();
    // Reconnecting clients send back their saved token to reclaim the seat;
    // brand-new players get a fresh one.
    const token = req.playerId && req.token ? req.token : randomUUID();
    socket.join(room.id);
    const rec = room.addOrReconnect({
      playerId,
      token,
      name: req.name ?? 'Player',
      socketId: socket.id,
    });
    boundRoomId = room.id;
    boundPlayerId = rec.playerId;
    ack?.({
      ok: true,
      roomId: room.id,
      playerId: rec.playerId,
      token: rec.token,
      isHost: room.hostId === rec.playerId,
    });
  });

  socket.on(NetEvents.SelectSide, (req: SelectSideReq) => {
    if (boundRoomId && boundPlayerId)
      manager.get(boundRoomId)?.selectSide(boundPlayerId, req.side);
  });

  socket.on(NetEvents.Ready, (req: ReadyReq) => {
    if (boundRoomId && boundPlayerId)
      manager.get(boundRoomId)?.setReady(boundPlayerId, req.ready);
  });

  socket.on(NetEvents.Configure, (req: ConfigureReq) => {
    if (boundRoomId && boundPlayerId)
      manager.get(boundRoomId)?.configure(boundPlayerId, req.rules);
  });

  socket.on(NetEvents.Rematch, () => {
    if (boundRoomId && boundPlayerId)
      manager.get(boundRoomId)?.rematch(boundPlayerId);
  });

  socket.on(NetEvents.Input, (req: InputReq) => {
    if (boundRoomId && boundPlayerId)
      manager.get(boundRoomId)?.applyInput(boundPlayerId, req);
  });

  socket.on(NetEvents.Leave, () => {
    if (boundRoomId) manager.get(boundRoomId)?.handleDisconnect(socket.id);
  });

  socket.on('disconnect', () => {
    if (boundRoomId) manager.get(boundRoomId)?.handleDisconnect(socket.id);
  });

  // Lightweight latency probe for the client HUD.
  socket.on('ping:client', (cb?: () => void) => cb?.());
});

http.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CourtLink server listening on :${PORT}`);
});
