import { useAgent } from "agents/react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Mirrors the server-side shape in worker/presence.ts (kept in sync by hand to
// avoid pulling the Worker's build graph into the client bundle).
export interface Presence {
  emoji: string;
  lng?: number;
  lat?: number;
  lastSeen: number;
  outsideSince?: number;
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

  // Keep the latest fix so we can (re)send it as soon as the socket opens.
  const lastLoc = useRef<string | null>(null);

  const socket = useAgent<PresenceState>({
    agent: "PresenceAgent",
    name: "global",
    query: { userId },
    onStateUpdate: (state) => setUsers(state?.users ?? {}),
  });

  // Flush the most recent location once (re)connected.
  useEffect(() => {
    const flush = () => {
      if (lastLoc.current) socket.send(lastLoc.current);
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
      value={{ myId: userId, myEmoji: users[userId]?.emoji, users }}
    >
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within <PresenceProvider>");
  return ctx;
}
