"use client";

const VALUES = Array.from({ length: 11 }, (_, index) => index * 0.5);

type RatingPillsProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

export function RatingPills({
  value,
  onChange,
  disabled = false,
  className = "",
}: RatingPillsProps) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {VALUES.map((option) => {
        const active = option === value;

        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`rounded-full border px-2.5 py-1 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "border-cyan-300 bg-cyan-400 text-slate-950"
                : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {option.toFixed(1)}
          </button>
        );
      })}
    </div>
  );
}
