import { Agent, type Connection, type ConnectionContext } from "agents";

/** How long a user's last-known location survives without them being live. */
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const PRUNE_INTERVAL_S = 60;

/** One live visitor: an assigned emoji and (optionally) a last-known position. */
export interface Presence {
  emoji: string;
  lng?: number;
  lat?: number;
  lastSeen: number; // epoch ms
}

export interface PresenceState {
  users: Record<string, Presence>;
}

/** Minimal shape of the Kew boundary GeoJSON we read from the static assets. */
interface BoundaryGeoJSON {
  features: { geometry: { coordinates: number[][][] } }[];
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
 * A user's location is dropped if they leave the Kew boundary, and their whole
 * presence is pruned once they've not been live for 30 minutes.
 */
export class PresenceAgent extends Agent<Env, PresenceState> {
  initialState: PresenceState = { users: {} };

  // Lazily-loaded, then cached, Kew boundary ring (read from the static assets).
  private ring: [number, number][] | null = null;

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

    const users = { ...this.state.users };
    const prev = users[userId];
    const emoji =
      prev?.emoji ??
      assignEmoji(userId, new Set(Object.values(users).map((u) => u.emoji)));

    const ring = await this.boundaryRing();
    if (pointInRing(lng, lat, ring)) {
      users[userId] = { emoji, lng, lat, lastSeen: Date.now() };
    } else {
      // Outside the gardens — keep the visitor's identity but drop their marker.
      users[userId] = { emoji, lastSeen: Date.now() };
    }
    this.setState({ users });
  }

  // Note: we deliberately keep a user's entry on disconnect so their last-known
  // location lingers on the map until the 30-minute TTL prunes it below.

  /** Recurring alarm: drop anyone who hasn't been live for the TTL. */
  prune() {
    const now = Date.now();
    // A visitor with an open socket is "live" regardless of when they last moved.
    const live = new Set<string>();
    for (const c of this.getConnections<{ userId?: string }>()) {
      const id = c.state?.userId;
      if (id) live.add(id);
    }

    const next: Record<string, Presence> = {};
    let changed = false;
    for (const [id, u] of Object.entries(this.state.users)) {
      if (live.has(id) || now - u.lastSeen <= TTL_MS) next[id] = u;
      else changed = true;
    }
    if (changed) this.setState({ users: next });
  }

  private async boundaryRing(): Promise<[number, number][]> {
    if (this.ring) return this.ring;
    const res = await this.env.ASSETS.fetch(
      new Request("https://assets.local/kew-boundary.geojson"),
    );
    const gj = (await res.json()) as BoundaryGeoJSON;
    this.ring = (gj.features[0]?.geometry.coordinates[0] as [number, number][]) ?? [];
    return this.ring;
  }
}
