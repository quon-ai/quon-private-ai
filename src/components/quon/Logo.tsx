type Props = { size?: "sm" | "md" | "lg" | "xl"; className?: string };

const sizes: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-xl",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-7xl",
};

export function Logo({ size = "md", className = "" }: Props) {
  return (
    <span className={`font-extrabold tracking-tight ${sizes[size]} text-quon-text ${className}`}>
      QU<span className="text-quon-indigo">O</span>N
    </span>
  );
}

/** Compact square mark for the collapsed sidebar (icon-only width). */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/15 text-sm font-extrabold text-quon-text ${className}`}
    >
      Q<span className="text-quon-indigo">.</span>
    </span>
  );
}
