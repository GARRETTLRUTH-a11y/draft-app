type PrestigeStarsProps = {
  value: number | null | undefined;
  className?: string;
};

export function PrestigeStars({ value, className = "" }: PrestigeStarsProps) {
  if (value == null) {
    return (
      <span className={`text-[9px] font-semibold text-slate-500 ${className}`}>
        (TBD)
      </span>
    );
  }

  const fillPercent = (Math.max(0, Math.min(5, value)) / 5) * 100;

  return (
    <span
      className={`inline-flex items-center gap-px text-[9px] leading-none text-slate-500 ${className}`}
      title={`${value} / 5 prestige`}
    >
      (
      <span className="relative inline-flex tracking-tighter">
        <span className="text-slate-600">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden whitespace-nowrap text-amber-400"
          style={{ width: `${fillPercent}%` }}
        >
          ★★★★★
        </span>
      </span>
      )
    </span>
  );
}
