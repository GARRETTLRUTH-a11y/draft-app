"use client";

type RatingSliderProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

const TICK_COUNT = 11; // 0, 0.5, 1, ..., 5

export function RatingSlider({
  value,
  onChange,
  disabled = false,
  className = "",
}: RatingSliderProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative h-5 w-48">
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="absolute inset-y-0 left-0 h-2 w-48 cursor-pointer appearance-none self-center rounded-full bg-white/10 accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
        />

        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between">
          {Array.from({ length: TICK_COUNT }).map((_, index) => {
            const isWholeStar = index % 2 === 0;

            return (
              <span
                key={index}
                className={`w-px rounded-full ${
                  isWholeStar ? "h-2.5 bg-white/40" : "h-1.5 bg-white/20"
                }`}
              />
            );
          })}
        </div>
      </div>

      <span className="w-12 flex-shrink-0 text-sm font-bold text-cyan-300">
        {value.toFixed(1)}★
      </span>
    </div>
  );
}
