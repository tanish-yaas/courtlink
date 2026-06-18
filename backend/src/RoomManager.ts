/**
 * RoomManager — registry of live rooms and unique room-code generation.
 * Rooms are reaped when empty so memory does not grow unbounded.
 */
import type { Server } from 'socket.io';
import { ROOM_CODE_LENGTH, type RuleConfig } from './shared/constants';
import { Room } from './Room';

// Avoid ambiguous characters (0/O, 1/I) in shareable codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private io: Server) {}

  create(rules?: Partial<RuleConfig>): Room {
    const id = this.uniqueCode();
    const room = new Room(id, this.io, rules);
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id.toUpperCase());
  }

  /** Periodically called to drop empty rooms and stop their loops. */
  reap() {
    for (const [id, room] of this.rooms) {
      if (room.isEmpty) {
        room.stopLoop();
        this.rooms.delete(id);
      }
    }
  }

  private uniqueCode(): string {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }
}
