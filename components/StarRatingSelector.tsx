"use client";

type StarRatingSelectorProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

const SEGMENTS = 10;

export function StarRatingSelector({
  value,
  onChange,
  disabled = false,
  className = "",
}: StarRatingSelectorProps) {
  const fillPercent = (Math.max(0, Math.min(5, value)) / 5) * 100;

  return (
    <div
      className={`relative inline-flex h-6 w-32 select-none ${
        disabled ? "opacity-40" : ""
      } ${className}`}
    >
      <span className="absolute inset-0 flex items-center text-2xl leading-none tracking-tighter text-slate-600">
        ★★★★★
      </span>

      <span
        className="absolute inset-y-0 left-0 flex items-center overflow-hidden whitespace-nowrap text-2xl leading-none tracking-tighter text-amber-400"
        style={{ width: `${fillPercent}%` }}
      >
        ★★★★★
      </span>

      <div className="absolute inset-0 grid grid-cols-10">
        {Array.from({ length: SEGMENTS }).map((_, index) => {
          const segmentValue = (index + 1) * 0.5;

          return (
            <button
              key={index}
              type="button"
              disabled={disabled}
              aria-label={`${segmentValue} stars`}
              title={`${segmentValue} stars`}
              onClick={() => onChange(segmentValue)}
              className="h-full w-full cursor-pointer disabled:cursor-not-allowed"
            />
          );
        })}
      </div>
    </div>
  );
}
