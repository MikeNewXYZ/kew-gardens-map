import { Link, Outlet } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { EMOJI_CHOICES, usePresence } from "../lib/presence.tsx";
import styles from "./AppLayout.module.css";

const ICON = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  guide: (
    <>
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <line x1="9" y1="4" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="20" />
    </>
  ),
} as const;

const TABS = [
  { to: "/search", label: "Search", icon: ICON.search },
  { to: "/map", label: "Map", icon: ICON.map },
  { to: "/pdf", label: "Guide", icon: ICON.guide },
] as const;

function TabIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function AppLayout() {
  const { myEmoji, celebrate, liveCount, setEmoji } = usePresence();
  const [menuOpen, setMenuOpen] = useState(false);

  // Press-and-hold (500ms) opens the avatar picker; a short tap celebrates.
  const holdTimer = useRef<number | null>(null);
  const heldOpened = useRef(false);

  function startHold() {
    heldOpened.current = false;
    holdTimer.current = window.setTimeout(() => {
      heldOpened.current = true;
      setMenuOpen(true);
      navigator.vibrate?.(15); // subtle cue that the picker opened
    }, 500);
  }
  function cancelHold() {
    if (holdTimer.current != null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }
  function onYouClick() {
    if (heldOpened.current) {
      heldOpened.current = false; // this "click" ends a long press — don't celebrate
      return;
    }
    celebrate();
  }

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <span className={styles.crest} aria-hidden>
          ❦
        </span>
        <div className={styles.brand}>
          <h1>Kew</h1>
          <p>Garden Map</p>
        </div>
        <div className={styles.headerRight}>
          {liveCount > 0 && (
            <span
              className={styles.live}
              title={`${liveCount} ${liveCount === 1 ? "person" : "people"} exploring right now`}
              aria-label={`${liveCount} live ${liveCount === 1 ? "visitor" : "visitors"}`}
            >
              <span className={styles.liveDot} aria-hidden />
              {liveCount} live
            </span>
          )}
          <div className={styles.youWrap}>
            <button
              type="button"
              className={styles.you}
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onClick={onYouClick}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!myEmoji}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Tap to celebrate · hold to change your avatar"
              aria-label={myEmoji ? `You are ${myEmoji}. Tap to celebrate, hold to change avatar` : "Connecting…"}
            >
              {myEmoji ?? "…"}
            </button>

            {menuOpen && (
              <>
                <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
                <div className={styles.youMenu} role="menu">
                  <div className={styles.youMenuTitle}>Your avatar</div>
                  <div className={styles.emojiGrid}>
                    {EMOJI_CHOICES.map((e) => (
                      <button
                        key={e}
                        type="button"
                        role="menuitemradio"
                        aria-checked={e === myEmoji}
                        className={`${styles.emojiChoice} ${e === myEmoji ? styles.emojiChoiceActive : ""}`}
                        onClick={() => {
                          setEmoji(e);
                          setMenuOpen(false);
                        }}
                        aria-label={`Use ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.celebrateBtn}
                    onClick={() => {
                      celebrate();
                      setMenuOpen(false);
                    }}
                  >
                    🎉 Celebrate
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.dock} aria-label="Sections">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={styles.dockItem}
            activeProps={{ className: `${styles.dockItem} ${styles.dockItemActive}` }}
          >
            <TabIcon>{tab.icon}</TabIcon>
            <span className={styles.dockLabel}>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
