import { useEffect, useState } from "react";

interface Props {
  value: number | null;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  highlight?: boolean;
}

/** Number cell that saves on blur/Enter, so typing doesn't write on every keystroke. */
export default function NumInput({ value, onCommit, disabled, className, placeholder, highlight }: Props) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);

  function commit() {
    const t = text.trim();
    const v = t === "" ? null : Number(t.replace(/,/g, ""));
    if (v !== null && !Number.isFinite(v)) return setText(value == null ? "" : String(value));
    if (v !== value) onCommit(v);
  }

  return (
    <input
      inputMode="decimal"
      className={`input-sm ${highlight ? "border-amber-400 bg-amber-50" : ""} ${className ?? ""}`}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
