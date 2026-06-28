"use client";

type RatingSliderProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

export function RatingSlider({
  value,
  onChange,
  disabled = false,
  className = "",
}: RatingSliderProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <input
        type="range"
        min={0}
        max={5}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-48 cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
      />

      <span className="w-12 flex-shrink-0 text-sm font-bold text-cyan-300">
        {value.toFixed(1)}★
      </span>
    </div>
  );
}
