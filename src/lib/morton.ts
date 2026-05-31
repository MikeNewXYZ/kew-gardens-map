// Playful audio + haptics for the map buttons. Sounds are synthesised with the
// Web Audio API and the device buzzes via the Web Vibration API. Both are
// created lazily on the user gesture (required by autoplay policies) and degrade
// silently where unsupported (e.g. iOS Safari has no Vibration API).

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  /** Optional pitch to glide down/up to over the note (for the trombone bend). */
  bendTo?: number;
}

/** Schedule a sequence of notes once the context is actually running. */
function playSequence(
  notes: Note[],
  opts: { type: OscillatorType; noteMs: number; release: number; volume: number },
) {
  const audio = audioContext();
  if (!audio) return;

  const run = () => {
    const start = audio.currentTime + 0.06; // small lead so note 1 isn't dropped
    const master = audio.createGain();
    master.gain.value = opts.volume;
    master.connect(audio.destination);

    notes.forEach((note, i) => {
      const t = start + (i * opts.noteMs) / 1000;
      const end = t + opts.release;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = opts.type;
      osc.frequency.setValueAtTime(note.freq, t);
      if (note.bendTo) osc.frequency.exponentialRampToValueAtTime(note.bendTo, end);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(end + 0.02);
    });
  };

  // A freshly-created context starts "suspended"; schedule only once running.
  if (audio.state === "suspended") audio.resume().then(run).catch(() => {});
  else run();
}

function buzz(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

// A cheerful ascending phrase: C5 D5 E5 G5 A5 C6 (C-major pentatonic).
const HAPPY: Note[] = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5].map((freq) => ({ freq }));

/** Play the Morton melody and buzz. Call from a click/tap handler. */
export function playMorton() {
  playSequence(HAPPY, { type: "triangle", noteMs: 150, release: 0.26, volume: 0.5 });
  buzz([40, 110, 40, 110, 40, 110, 40, 110, 40, 110, 70]);
}

// Sad trombone: three descending "womp"s and a final note that bends downward.
const SAD: Note[] = [
  { freq: 311.13 }, // Eb4
  { freq: 277.18 }, // Db4
  { freq: 246.94 }, // B3
  { freq: 220.0, bendTo: 110.0 }, // A3 sliding down an octave — the "wommp"
];

/** Play a sad trombone and give a dejected buzz. Call from a click/tap handler. */
export function playFail() {
  playSequence(SAD, { type: "sawtooth", noteMs: 320, release: 0.42, volume: 0.32 });
  buzz([300, 120, 500]);
}
