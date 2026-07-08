export default function Loading() {
  return (
    <div className="pt-12" role="status" aria-label="Loading">
      <div className="animate-pulse space-y-6 max-w-[860px]">
        <div className="h-3 w-40 rounded bg-[var(--ash)]" />
        <div className="h-9 w-72 rounded bg-[var(--ash)]" />
        <div className="h-28 rounded-[8px] bg-[var(--ash)] opacity-60" />
        <div className="h-28 rounded-[8px] bg-[var(--ash)] opacity-40" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
