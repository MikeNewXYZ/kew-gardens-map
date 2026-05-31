import { Agent, type Connection, type ConnectionContext } from "agents";
import { KEW_BOUNDARY_RING } from "./kew-boundary.ts";

/** How long a visitor's whole presence survives once they stop being live. */
const TTL_MS = 30 * 60 * 1000; // 30 minutes
/** How long a last-known location is kept after the visitor leaves the gardens. */
const OUTSIDE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PRUNE_INTERVAL_S = 60;
/** London-local date string (YYYY-MM-DD) — used to wipe locations each day. */
function londonDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** One live visitor: an assigned emoji and (optionally) a last-known position. */
export interface Presence {
  emoji: string;
  lng?: number;
  lat?: number;
  lastSeen: number; // epoch ms
  /** When the visitor first went outside the boundary (cleared once back in). */
  outsideSince?: number;
}

export interface PresenceState {
  users: Record<string, Presence>;
  /** London day of the last end-of-day location wipe. */
  lastResetDay?: string;
}

/** A location update pushed from a client over the WebSocket. */
interface LocMessage {
  type: "loc";
  lng: number;
  lat: number;
}

// Distinct, friendly emoji assigned one-per-visitor.
const EMOJI_POOL = [
  "🦊", "🦉", "🦋", "🐝", "🐞", "🦔", "🐢", "🦆", "🦢", "🐿️",
  "🦜", "🐸", "🦚", "🦩", "🐥", "🦡", "🦦", "🌻", "🌷", "🌹",
  "🌼", "🍄", "🌿", "🍀", "🌸", "💐", "🌺", "🪻", "🪷", "🐌",
  "🦫", "🐇", "🦥", "🐠", "🐳", "🦭", "🍁", "🌴", "🐬", "🦚",
];

/** Stable fallback when every emoji in the pool is already taken. */
function hashIndex(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return Math.abs(h) % EMOJI_POOL.length;
}

function assignEmoji(userId: string, used: Set<string>): string {
  const free = EMOJI_POOL.find((e) => !used.has(e));
  return free ?? EMOJI_POOL[hashIndex(userId)];
}

/** Ray-casting point-in-polygon test (ring is [lng, lat] pairs). */
function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const hit =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * Shared real-time presence "room", built on the Agents SDK as a stateful
 * Durable Object. Every visitor connects (over a WebSocket) to the single
 * `global` instance and is given an emoji + their last-known position. The
 * Agent's state is automatically broadcast to all connected clients, so each
 * visitor sees everyone else move in real time.
 *
 * Location lifetime:
 *  - Inside the gardens: the last-known position is kept while the visitor is live.
 *  - Outside the gardens: the last-known position is still recorded, but removed
 *    15 minutes after they left.
 *  - End of day (London time): all stored locations are wiped.
 *  - The whole presence entry is pruned after 30 minutes of not being live.
 */
export class PresenceAgent extends Agent<Env, PresenceState> {
  initialState: PresenceState = { users: {} };

  async onStart() {
    // One recurring pruning alarm per instance (idempotent across wakes).
    if (this.getSchedules().length === 0) {
      await this.scheduleEvery(PRUNE_INTERVAL_S, "prune");
    }
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const userId = new URL(ctx.request.url).searchParams.get("userId");
    if (!userId) {
      connection.close(1008, "userId query param required");
      return;
    }
    // Remember which visitor this socket belongs to (onMessage has no request).
    connection.setState({ userId });

    const users = { ...this.state.users };
    const existing = users[userId];
    users[userId] = existing
      ? { ...existing, lastSeen: Date.now() }
      : {
          emoji: assignEmoji(userId, new Set(Object.values(users).map((u) => u.emoji))),
          lastSeen: Date.now(),
        };
    this.setState({ users });
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer) {
    const userId = (connection.state as { userId?: string } | null)?.userId;
    if (!userId || typeof message !== "string") return;

    let data: LocMessage;
    try {
      data = JSON.parse(message) as LocMessage;
    } catch {
      return;
    }
    if (data.type !== "loc") return;

    const lng = Number(data.lng);
    const lat = Number(data.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const now = Date.now();
    const users = { ...this.state.users };
    const prev = users[userId];
    const emoji =
      prev?.emoji ??
      assignEmoji(userId, new Set(Object.values(users).map((u) => u.emoji)));

    // Record the last-known position whether inside or outside the gardens.
    // Inside clears the "outside" stamp. Outside keeps the original stamp (so the
    // 15-minute window runs from when they first left, not from each update) and
    // stops recording the position once that window has passed.
    if (pointInRing(lng, lat, KEW_BOUNDARY_RING)) {
      users[userId] = { emoji, lng, lat, lastSeen: now, outsideSince: undefined };
    } else {
      const outsideSince = prev?.outsideSince ?? now;
      const expired = now - outsideSince > OUTSIDE_TTL_MS;
      users[userId] = expired
        ? { emoji, lastSeen: now, outsideSince }
        : { emoji, lng, lat, lastSeen: now, outsideSince };
    }
    this.setState({ users });
  }

  // Note: we deliberately keep a user's entry on disconnect so their last-known
  // location lingers on the map until the 30-minute TTL prunes it below.

  /**
   * Recurring alarm. Enforces, in order: the end-of-day location wipe, the
   * 15-minute expiry of out-of-bounds locations, and the 30-minute removal of
   * visitors who are no longer live.
   */
  prune() {
    const now = Date.now();
    const today = londonDay(now);
    // On a new London day, drop every stored location (identities are kept).
    const wipeLocations =
      this.state.lastResetDay !== undefined && this.state.lastResetDay !== today;

    // A visitor with an open socket is "live" regardless of when they last moved.
    const live = new Set<string>();
    for (const c of this.getConnections<{ userId?: string }>()) {
      const id = c.state?.userId;
      if (id) live.add(id);
    }

    const next: Record<string, Presence> = {};
    let changed = wipeLocations || this.state.lastResetDay !== today;
    for (const [id, u] of Object.entries(this.state.users)) {
      // Liveness: remove the whole entry after 30 min of not being live.
      if (!live.has(id) && now - u.lastSeen > TTL_MS) {
        changed = true;
        continue;
      }
      const hasLocation = u.lng !== undefined || u.lat !== undefined;
      const expiredOutside =
        u.outsideSince !== undefined && now - u.outsideSince > OUTSIDE_TTL_MS;
      if (wipeLocations) {
        // End of day: clear the location AND the outside stamp (fresh start).
        if (hasLocation || u.outsideSince !== undefined) changed = true;
        next[id] = { emoji: u.emoji, lastSeen: u.lastSeen };
      } else if (expiredOutside) {
        // Outside > 15 min: clear the location but KEEP the stamp sticky, so a
        // continued stream of outside updates can't resurrect it (only coming
        // back inside resets it). The identity (emoji) is kept.
        if (hasLocation) changed = true;
        next[id] = { emoji: u.emoji, lastSeen: u.lastSeen, outsideSince: u.outsideSince };
      } else {
        next[id] = u;
      }
    }
    if (changed) this.setState({ users: next, lastResetDay: today });
  }
}
