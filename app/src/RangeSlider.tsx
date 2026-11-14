import * as Slider from "@radix-ui/react-slider";

export default function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Slider.Root
      className="range-slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([next]) => onChange(next)}
    >
      <Slider.Track className="range-slider-track">
        <Slider.Range className="range-slider-fill" />
      </Slider.Track>
      <Slider.Thumb className="range-slider-thumb" />
    </Slider.Root>
  );
}
