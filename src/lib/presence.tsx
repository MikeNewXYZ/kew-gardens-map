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
import failStyles from "./fail.module.css";

// A sad YouTube video for the Fail button. Swap this id for any video you like.
const FAIL_VIDEO_ID = "dQw4w9WgXcQ";
// How long the FAIL overlay stays up (ms).
const FAIL_MS = 11000;

// How long a celebration burst lingers on screen before it's cleaned up (ms).
const CELEBRATION_MS = 3200;
// Emoji particles per burst.
const PARTICLE_COUNT = 26;

// Avatar emojis a visitor can pick. MUST stay in sync with EMOJI_POOL in
// worker/presence.ts (the server rejects anything outside this set).
export const EMOJI_CHOICES = [
  "🦊", "🦉", "🦋", "🐝", "🐞", "🦔", "🐢", "🦆", "🦢", "🐿️",
  "🦜", "🐸", "🦚", "🦩", "🐥", "🦡", "🦦", "🌻", "🌷", "🌹",
  "🌼", "🍄", "🌿", "🍀", "🌸", "💐", "🌺", "🪻", "🪷", "🐌",
  "🦫", "🐇", "🦥", "🐠", "🐳", "🦭", "🍁", "🌴", "🐬",
];
const EMOJI_KEY = "kew-presence-emoji";

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
  onlineCount?: number;
  failCount?: number;
  lastResetDay?: string;
}

interface PresenceContextValue {
  /** This visitor's stable id. */
  myId: string;
  /** The emoji assigned to this visitor (undefined until connected). */
  myEmoji?: string;
  /** Everyone currently known to the presence room, keyed by id. */
  users: Record<string, Presence>;
  /** Visitors with an open socket right now (the live count for the header). */
  liveCount: number;
  /** All-time number of fails (Fail button presses) across everyone. */
  failCount: number;
  /** Broadcast (or clear, with null) this visitor's active route as a ghost. */
  publishRoute: (route: GhostRoute | null) => void;
  /** Fire a celebration burst of this visitor's emoji for everyone. */
  celebrate: () => void;
  /** Fire a musical-note burst (the Morton button) for everyone. */
  mortonForEveryone: () => void;
  /** Trigger the group FAIL (thumbs-down storm + sad video) for everyone. */
  failForEveryone: () => void;
  /** Choose a different avatar emoji (from EMOJI_CHOICES); persists + broadcasts. */
  setEmoji: (emoji: string) => void;
}

interface Burst {
  id: number;
  glyphs: string[]; // each particle picks a random glyph from this set
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
  const [liveCount, setLiveCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstSeq = useRef(0);
  const [fail, setFail] = useState<{ id: number; count: number } | null>(null);
  const failSeq = useRef(0);
  const failTimer = useRef<number | null>(null);

  // Keep the latest fix + route so we can (re)send them as soon as the socket opens.
  const lastLoc = useRef<string | null>(null);
  const lastRoute = useRef<string | null>(null);
  // A chosen avatar emoji persists across sessions and is re-applied on connect.
  const chosenEmoji = useRef<string | null>(localStorage.getItem(EMOJI_KEY));

  // Spawn a burst whose particles pick randomly from `glyphs`; auto-clears.
  const triggerBurst = useCallback((glyphs: string[]) => {
    const id = (burstSeq.current += 1);
    setBursts((b) => [...b, { id, glyphs }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), CELEBRATION_MS);
  }, []);

  // Show the FAIL overlay (sad video + tally) and auto-dismiss it.
  const triggerFailOverlay = useCallback((count: number) => {
    setFail({ id: (failSeq.current += 1), count });
    if (failTimer.current != null) clearTimeout(failTimer.current);
    failTimer.current = window.setTimeout(() => setFail(null), FAIL_MS);
  }, []);

  const socket = useAgent<PresenceState>({
    agent: "PresenceAgent",
    name: "global",
    query: { userId },
    onStateUpdate: (state) => {
      setUsers(state?.users ?? {});
      setLiveCount(state?.onlineCount ?? 0);
      setFailCount(state?.failCount ?? 0);
    },
    // Custom (non-state) frames: celebration / Morton / fail broadcasts.
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type?: string;
          emoji?: string;
          count?: number;
        };
        if (data.type === "celebrate" && typeof data.emoji === "string") {
          triggerBurst([data.emoji]);
        } else if (data.type === "morton") {
          triggerBurst(MUSIC_EMOJI);
        } else if (data.type === "fail") {
          triggerBurst(FAIL_EMOJI);
          triggerFailOverlay(data.count ?? 0);
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

  // Morton button: rain musical notes for everyone in the room.
  const mortonForEveryone = useCallback(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "morton" }));
    }
  }, [socket]);

  // Fail button: thumbs-down storm + sad video for everyone in the room.
  const failForEveryone = useCallback(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "fail" }));
    }
  }, [socket]);

  // Pick a new avatar emoji: persist it and tell the room (the state broadcast
  // updates this visitor's marker + header everywhere).
  const setEmoji = useCallback(
    (emoji: string) => {
      chosenEmoji.current = emoji;
      localStorage.setItem(EMOJI_KEY, emoji);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "setEmoji", emoji }));
      }
    },
    [socket],
  );

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

  // Flush the most recent location + route + chosen emoji once (re)connected.
  useEffect(() => {
    const flush = () => {
      if (chosenEmoji.current) {
        socket.send(JSON.stringify({ type: "setEmoji", emoji: chosenEmoji.current }));
      }
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
      value={{
        myId: userId,
        myEmoji: users[userId]?.emoji,
        users,
        liveCount,
        failCount,
        publishRoute,
        celebrate,
        mortonForEveryone,
        failForEveryone,
        setEmoji,
      }}
    >
      {children}
      <CelebrationOverlay bursts={bursts} />
      {fail && <FailOverlay key={fail.id} count={fail.count} onClose={() => setFail(null)} />}
    </PresenceContext.Provider>
  );
}

/** Over-the-top FAIL takeover: red flashing, screen shake, sirens, sad video. */
function FailOverlay({ count, onClose }: { count: number; onClose: () => void }) {
  const src =
    `https://www.youtube.com/embed/${FAIL_VIDEO_ID}` +
    `?autoplay=1&mute=1&controls=0&playsinline=1&modestbranding=1&rel=0&loop=1&playlist=${FAIL_VIDEO_ID}`;
  return (
    <div className={failStyles.overlay} role="alertdialog" aria-label="Epic fail">
      <div className={failStyles.siren} aria-hidden>🚨</div>
      <div className={failStyles.sirenRight} aria-hidden>🚨</div>
      <div className={failStyles.shake}>
        <div className={failStyles.title}>
          EPIC <span className={failStyles.titleHuge}>FAIL</span> 👎
        </div>
        <div className={failStyles.subtitle} aria-hidden>womp&nbsp;womp&nbsp;womp.</div>
        <div className={failStyles.videoWrap}>
          <iframe
            className={failStyles.video}
            src={src}
            title="A sad video"
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        {count > 0 && <div className={failStyles.tally}>FAIL #{count}</div>}
        <button type="button" className={failStyles.dismiss} onClick={onClose}>
          Ugh, dismiss
        </button>
      </div>
    </div>
  );
}

/** Full-screen, non-interactive layer that rains emoji for each active burst. */
function CelebrationOverlay({ bursts }: { bursts: Burst[] }) {
  if (bursts.length === 0) return null;
  return (
    <div className={celebrationStyles.overlay} aria-hidden>
      {bursts.map((b) => (
        <EmojiBurst key={b.id} glyphs={b.glyphs} />
      ))}
    </div>
  );
}

const MUSIC_EMOJI = ["🎵", "🎶", "🎼", "🎹", "🎺", "🎷", "🥁", "🎸"];
const FAIL_EMOJI = ["👎", "💀", "📉", "🤡", "😭", "💩", "🚫", "❌"];

function EmojiBurst({ glyphs }: { glyphs: string[] }) {
  // Randomised once per burst so particles don't reshuffle on re-render.
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => ({
        glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
        left: Math.random() * 100, // vw start
        drift: (Math.random() - 0.5) * 30, // vw horizontal drift
        delay: Math.random() * 0.5, // s
        dur: 1.8 + Math.random() * 1.3, // s
        rot: (Math.random() - 0.5) * 720, // deg
        size: 1.4 + Math.random() * 1.6, // rem
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {p.glyph}
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
