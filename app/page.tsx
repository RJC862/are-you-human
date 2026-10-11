import Link from "next/link";

export default function Home() {
  return (
    <main className="grid-backdrop min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="max-w-2xl">
        <span className="inline-block rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-mono uppercase tracking-widest text-accent">
          Proof of Personhood
        </span>
        <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl">
          Are You <span className="text-accent">Human?</span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-gray-400">
          Prove you are a real, present person on camera — not a deepfake,
          AI-generated avatar, replayed video, or AR beauty filter. A live
          liveness challenge powered by on-device vision and an AI verdict
          engine.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/verify"
            className="pulse-ring rounded-lg bg-accent px-8 py-3 text-base font-semibold text-white transition hover:bg-indigo-500"
          >
            Start Verification
          </Link>
          <Link
            href="/lobby"
            className="rounded-lg border border-gray-700 px-8 py-3 text-base font-semibold text-gray-300 transition hover:border-gray-500"
          >
            Try the Meeting Lobby Demo
          </Link>
        </div>

        <p className="mt-10 text-xs font-mono text-gray-600">
          100% on-device · In-browser MediaPipe · No video ever leaves your
          device
        </p>
      </div>
    </main>
  );
}
