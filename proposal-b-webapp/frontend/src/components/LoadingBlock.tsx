export default function LoadingBlock() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
      <span className="loading-pulse">読み込み中</span>
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
    </div>
  );
}
