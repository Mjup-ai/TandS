interface MessageBarProps {
  type: 'success' | 'error';
  text: string;
}

export default function MessageBar({ type, text }: MessageBarProps) {
  return (
    <div
      role="alert"
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${
        type === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800'
      }`}
    >
      {text}
    </div>
  );
}
