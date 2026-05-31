import { useAgent } from "agents/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import celebrationStyles from "./celebration.module.css";

// How long a celebration burst lingers on screen before it's cleaned up (ms).
const CELEBRATION_MS = 3200;
// Emoji particles per burst.
const PARTICLE_COUNT = 26;

// Mirrors the server-side shape in worker/presence.ts (kept in sync by hand to
// avoid pulling the Worker's build graph into the client bundle).
export interface GhostRoute {
  coordinates: [number, number][];
  destName?: string;
}
export interface Presence {
  emoji: string;
  lng?: number;
  lat?: number;
  lastSeen: number;
  route?: GhostRoute;
}
interface PresenceState {
  users: Record<string, Presence>;
  lastResetDay?: string;
}

interface PresenceContextValue {
  /** This visitor's stable id. */
  myId: string;
  /** The emoji assigned to this visitor (undefined until connected). */
  myEmoji?: string;
  /** Everyone currently known to the presence room, keyed by id. */
  users: Record<string, Presence>;
  /** Broadcast (or clear, with null) this visitor's active route as a ghost. */
  publishRoute: (route: GhostRoute | null) => void;
  /** Fire a celebration burst of this visitor's emoji for everyone. */
  celebrate: () => void;
}

interface Burst {
  id: number;
  emoji: string;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

const UID_KEY = "kew-presence-uid";

function loadUserId(): string {
  let id = localStorage.getItem(UID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(UID_KEY, id);
  }
  return id;
}

/**
 * Connects the visitor to the shared presence Durable Object (Agents SDK),
 * streams their GPS position up, and exposes everyone's live positions. Mount
 * once near the app root so the header and the map share a single connection.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const [userId] = useState(loadUserId);
  const [users, setUsers] = useState<Record<string, Presence>>({});
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstSeq = useRef(0);

  // Keep the latest fix + route so we can (re)send them as soon as the socket opens.
  const lastLoc = useRef<string | null>(null);
  const lastRoute = useRef<string | null>(null);

  // Spawn a celebration burst that auto-clears after the animation finishes.
  const triggerBurst = useCallback((emoji: string) => {
    const id = (burstSeq.current += 1);
    setBursts((b) => [...b, { id, emoji }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), CELEBRATION_MS);
  }, []);

  const socket = useAgent<PresenceState>({
    agent: "PresenceAgent",
    name: "global",
    query: { userId },
    onStateUpdate: (state) => setUsers(state?.users ?? {}),
    // Custom (non-state) frames: a celebration broadcast from any visitor.
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data as string) as { type?: string; emoji?: string };
        if (data.type === "celebrate" && typeof data.emoji === "string") {
          triggerBurst(data.emoji);
        }
      } catch {
        // internal agent frames / non-JSON — ignore
      }
    },
  });

  // Tell the room to celebrate as us; the server echoes it back to everyone.
  const celebrate = useCallback(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "celebrate" }));
    }
  }, [socket]);

  // Broadcast (or clear) this visitor's active navigation route.
  const publishRoute = useCallback(
    (route: GhostRoute | null) => {
      const msg = route
        ? JSON.stringify({ type: "nav", coordinates: route.coordinates, destName: route.destName })
        : JSON.stringify({ type: "nav-end" });
      // A finished route must NOT be resurrected on reconnect.
      lastRoute.current = route ? msg : null;
      if (socket.readyState === WebSocket.OPEN) socket.send(msg);
    },
    [socket],
  );

  // Flush the most recent location + active route once (re)connected.
  useEffect(() => {
    const flush = () => {
      if (lastLoc.current) socket.send(lastLoc.current);
      if (lastRoute.current) socket.send(lastRoute.current);
    };
    socket.addEventListener("open", flush);
    return () => socket.removeEventListener("open", flush);
  }, [socket]);

  // Stream the device location up to the room.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const msg = JSON.stringify({
          type: "loc",
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
        });
        lastLoc.current = msg;
        if (socket.readyState === WebSocket.OPEN) socket.send(msg);
      },
      () => {}, // permission denied / unavailable — stay connected, just no marker
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [socket]);

  return (
    <PresenceContext.Provider
      value={{ myId: userId, myEmoji: users[userId]?.emoji, users, publishRoute, celebrate }}
    >
      {children}
      <CelebrationOverlay bursts={bursts} />
    </PresenceContext.Provider>
  );
}

/** Full-screen, non-interactive layer that rains emoji for each active burst. */
function CelebrationOverlay({ bursts }: { bursts: Burst[] }) {
  if (bursts.length === 0) return null;
  return (
    <div className={celebrationStyles.overlay} aria-hidden>
      {bursts.map((b) => (
        <EmojiBurst key={b.id} emoji={b.emoji} />
      ))}
    </div>
  );
}

function EmojiBurst({ emoji }: { emoji: string }) {
  // Randomised once per burst so particles don't reshuffle on re-render.
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => ({
        left: Math.random() * 100, // vw start
        drift: (Math.random() - 0.5) * 30, // vw horizontal drift
        delay: Math.random() * 0.5, // s
        dur: 1.8 + Math.random() * 1.3, // s
        rot: (Math.random() - 0.5) * 720, // deg
        size: 1.4 + Math.random() * 1.6, // rem
      })),
    [],
  );
  return (
    <>
      {particles.map((p, i) => (
        <span
          key={i}
          className={celebrationStyles.particle}
          style={
            {
              left: `${p.left}vw`,
              fontSize: `${p.size}rem`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              "--drift": `${p.drift}vw`,
              "--rot": `${p.rot}deg`,
            } as React.CSSProperties
          }
        >
          {emoji}
        </span>
      ))}
    </>
  );
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within <PresenceProvider>");
  return ctx;
}
