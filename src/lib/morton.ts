// "The Morton button": a playful flourish that plays a short melody via the Web
// Audio API and buzzes the device via the Web Vibration API. Both are created
// lazily on the user gesture (required for audio autoplay policies) and degrade
// silently where unsupported (e.g. iOS Safari has no Vibration API).

let ctx: AudioContext | null = null;

// A cheerful ascending phrase: C5 D5 E5 G5 A5 C6 (C-major pentatonic).
const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
const NOTE_MS = 150;

function playNotes() {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    const audio = ctx;

    const schedule = () => {
      // Small lead so the first note isn't scheduled in the past (which some
      // browsers drop), and route everything through one master gain.
      const start = audio.currentTime + 0.06;
      const master = audio.createGain();
      master.gain.value = 0.5;
      master.connect(audio.destination);

      NOTES.forEach((freq, i) => {
        const t = start + (i * NOTE_MS) / 1000;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t);
        // Plucked envelope: fast attack, exponential decay.
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 0.28);
      });
    };

    // A freshly-created context starts "suspended" until resumed — schedule the
    // notes only once it's actually running, or they never sound.
    if (audio.state === "suspended") audio.resume().then(schedule).catch(() => {});
    else schedule();
  } catch {
    // Audio unsupported / blocked — stay silent.
  }
}

function buzz() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    // One short buzz per note, spaced to match the melody.
    navigator.vibrate([40, 110, 40, 110, 40, 110, 40, 110, 40, 110, 70]);
  }
}

/** Play the Morton melody and vibrate. Call from a click/tap handler. */
export function playMorton() {
  playNotes();
  buzz();
}
