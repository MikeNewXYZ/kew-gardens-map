import { Agent, type Connection, type ConnectionContext } from "agents";
import { KEW_BOUNDARY_RING } from "./kew-boundary.ts";

/** How long a visitor's whole presence survives once they stop being live. */
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const PRUNE_INTERVAL_S = 60;
/** Cap on broadcast route size — the whole state is re-sent to every client. */
const MAX_ROUTE_POINTS = 64;

/** London-local date string (YYYY-MM-DD) — used to wipe locations each day. */
function londonDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** A walking route a visitor is following, broadcast to others as a "ghost". */
export interface GhostRoute {
  coordinates: [number, number][];
  destName?: string;
}

/** One live visitor: an assigned emoji, an optional in-bounds position + route. */
export interface Presence {
  emoji: string;
  lng?: number;
  lat?: number;
  lastSeen: number; // epoch ms
  route?: GhostRoute;
}

export interface PresenceState {
  users: Record<string, Presence>;
  /** Distinct visitors with an open socket right now (true "live" count). */
  onlineCount?: number;
  /** London day of the last end-of-day location wipe. */
  lastResetDay?: string;
}

/** Messages a client can push over the WebSocket. */
interface LocMessage {
  type: "loc";
  lng: number;
  lat: number;
}
interface NavMessage {
  type: "nav";
  coordinates: [number, number][];
  destName?: string;
}
interface NavEndMessage {
  type: "nav-end";
}
/** A one-off celebration the sender wants everyone to see (ephemeral). */
interface CelebrateMessage {
  type: "celebrate";
}
/** The Morton button: rain musical notes for everyone (ephemeral). */
interface MortonMessage {
  type: "morton";
}
/** Visitor picks a different avatar emoji for themselves. */
interface SetEmojiMessage {
  type: "setEmoji";
  emoji: string;
}
type ClientMessage =
  | LocMessage
  | NavMessage
  | NavEndMessage
  | CelebrateMessage
  | MortonMessage
  | SetEmojiMessage;

/** Uniformly downsample a route to a fixed budget, always keeping both ends. */
function downsampleRoute(coords: [number, number][]): [number, number][] {
  if (coords.length <= MAX_ROUTE_POINTS) return coords;
  const out: [number, number][] = [];
  const stride = (coords.length - 1) / (MAX_ROUTE_POINTS - 1);
  for (let i = 0; i < MAX_ROUTE_POINTS; i++) out.push(coords[Math.round(i * stride)]);
  out[out.length - 1] = coords[coords.length - 1]; // exact destination
  return out;
}

// Distinct, friendly emoji assigned one-per-visitor.
const EMOJI_POOL = [
  "🦊", "🦉", "🦋", "🐝", "🐞", "🦔", "🐢", "🦆", "🦢", "🐿️",
  "🦜", "🐸", "🦚", "🦩", "🐥", "🦡", "🦦", "🌻", "🌷", "🌹",
  "🌼", "🍄", "🌿", "🍀", "🌸", "💐", "🌺", "🪻", "🪷", "🐌",
  "🦫", "🐇", "🦥", "🐠", "🐳", "🦭", "🍁", "🌴", "🐬", "🦚",
];

/** Emojis a visitor is allowed to pick (must match the client's picker). */
const EMOJI_SET = new Set(EMOJI_POOL);

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
 * `global` instance and is given an emoji. The Agent's state is automatically
 * broadcast to all connected clients, so each visitor sees everyone else move
 * (and, while navigating, each other's route as a "ghost") in real time.
 *
 * Location lifetime:
 *  - Inside the gardens: the last-known position is kept while the visitor is live.
 *  - Outside the gardens: the position is NOT stored (the marker simply drops).
 *  - End of day (London time): all stored locations and routes are wiped.
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

  /** Distinct visitors with at least one open socket (optionally excluding one). */
  private liveCount(excludeConnId?: string): number {
    const ids = new Set<string>();
    for (const c of this.getConnections<{ userId?: string }>()) {
      if (c.id === excludeConnId) continue;
      const id = c.state?.userId;
      if (id) ids.add(id);
    }
    return ids.size;
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
    this.setState({ ...this.state, users, onlineCount: this.liveCount() });
  }

  // Keep the live count honest the moment a socket drops (the visitor's entry
  // lingers for last-known location, but they're no longer "online").
  async onClose(connection: Connection) {
    this.setState({ ...this.state, onlineCount: this.liveCount(connection.id) });
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer) {
    const userId = (connection.state as { userId?: string } | null)?.userId;
    if (!userId || typeof message !== "string") return;

    let data: ClientMessage;
    try {
      data = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    const now = Date.now();
    const users = { ...this.state.users };
    const prev = users[userId];
    const emoji =
      prev?.emoji ??
      assignEmoji(userId, new Set(Object.values(users).map((u) => u.emoji)));

    if (data.type === "celebrate") {
      // Ephemeral: fan the celebration out to everyone (sender included) without
      // touching state, so each client can play the burst animation.
      const msg = JSON.stringify({ type: "celebrate", emoji, userId });
      for (const conn of this.getConnections()) conn.send(msg);
      return;
    }

    if (data.type === "morton") {
      // Ephemeral musical-note burst for the whole room.
      const msg = JSON.stringify({ type: "morton", userId });
      for (const conn of this.getConnections()) conn.send(msg);
      return;
    }

    if (data.type === "setEmoji") {
      // Only allow emojis from the known pool; the state broadcast then updates
      // this visitor's marker/header for everyone.
      if (typeof data.emoji !== "string" || !EMOJI_SET.has(data.emoji)) return;
      users[userId] = { ...(prev ?? { lastSeen: now }), emoji: data.emoji, lastSeen: now };
      this.setState({ ...this.state, users });
      return;
    }

    if (data.type === "loc") {
      const rawLng = Number(data.lng);
      const rawLat = Number(data.lat);
      if (!Number.isFinite(rawLng) || !Number.isFinite(rawLat)) return;
      // Round to ~1m so GPS jitter doesn't churn state, and store only positions
      // inside the gardens (outside, the marker drops). Route is preserved
      // across the frequent location ticks.
      const inside = pointInRing(rawLng, rawLat, KEW_BOUNDARY_RING);
      const lng = inside ? Math.round(rawLng * 1e5) / 1e5 : undefined;
      const lat = inside ? Math.round(rawLat * 1e5) / 1e5 : undefined;
      // Skip the write+broadcast entirely if nothing visible changed — this is
      // what stops a room of stationary visitors from re-broadcasting the whole
      // state on every tick. Liveness is tracked via open sockets in prune().
      if (prev && prev.lng === lng && prev.lat === lat) return;
      users[userId] = { emoji, lng, lat, lastSeen: now, route: prev?.route };
      this.setState({ users });
      return;
    }

    if (data.type === "nav") {
      const coords = Array.isArray(data.coordinates)
        ? data.coordinates.filter(
            (c): c is [number, number] =>
              Array.isArray(c) &&
              c.length === 2 &&
              Number.isFinite(c[0]) &&
              Number.isFinite(c[1]),
          )
        : [];
      if (coords.length < 2) return;
      const destName =
        typeof data.destName === "string" ? data.destName.slice(0, 120) : undefined;
      users[userId] = {
        ...(prev ?? { emoji }),
        emoji,
        lastSeen: now,
        route: { coordinates: downsampleRoute(coords), destName },
      };
      this.setState({ users });
      return;
    }

    if (data.type === "nav-end") {
      if (!prev) return;
      users[userId] = { ...prev, lastSeen: now, route: undefined };
      this.setState({ users });
    }
  }

  // Note: we deliberately keep a user's entry on disconnect so their last-known
  // location lingers on the map until the 30-minute TTL prunes it below.

  /**
   * Recurring alarm. Enforces the end-of-day location/route wipe and the
   * 30-minute removal of visitors who are no longer live.
   */
  prune() {
    const now = Date.now();
    const today = londonDay(now);
    // On a new London day, drop every stored location and route (identities kept).
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
      if (wipeLocations) {
        if (u.lng !== undefined || u.lat !== undefined || u.route !== undefined) {
          changed = true;
        }
        next[id] = { emoji: u.emoji, lastSeen: u.lastSeen };
      } else {
        next[id] = u;
      }
    }
    // Periodic correction for the live count (covers any missed close events).
    if (this.state.onlineCount !== live.size) changed = true;
    if (changed) {
      this.setState({ users: next, lastResetDay: today, onlineCount: live.size });
    }
  }
}
