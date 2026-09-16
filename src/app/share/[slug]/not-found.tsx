import Link from "next/link";

export default function ShareNotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">This link doesn&apos;t exist</h1>
        <p className="mt-1 text-sm text-zinc-500">It may have been removed, or the URL is incomplete.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
          Go to Minutes
        </Link>
      </div>
    </main>
  );
}
