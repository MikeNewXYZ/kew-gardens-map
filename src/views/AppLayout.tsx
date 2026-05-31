import { Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { usePresence } from "../lib/presence.tsx";
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
  const { myEmoji } = usePresence();
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
        <span
          className={styles.you}
          title="You on the map"
          aria-label={myEmoji ? `You are ${myEmoji}` : "Connecting…"}
        >
          {myEmoji ?? "…"}
        </span>
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
