import Link from "next/link";

export default function Home() {
  return (
    <main className="grid-backdrop flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="max-w-2xl">
        <span className="inline-block rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-mono uppercase tracking-widest text-accent">
          Liveness Check
        </span>
        <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl">
          Are You <span className="text-accent">Human?</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-gray-400">
          Prove you are a real, present person on camera. Complete a short,
          randomized sequence of liveness challenges — blink, smile, turn your
          head, touch your nose — all verified on your device.
        </p>

        <div className="mt-10">
          <Link
            href="/verify"
            className="pulse-ring inline-block rounded-lg bg-accent px-8 py-3 text-base font-semibold text-white transition hover:bg-indigo-500"
          >
            Start the check
          </Link>
        </div>

        <p className="mt-10 text-xs font-mono text-gray-600">
          100% on-device · In-browser MediaPipe · No video leaves your device
        </p>
      </div>
    </main>
  );
}
