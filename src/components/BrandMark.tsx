export function BrandMark({
  className = "h-[27px] w-[27px]",
  tone = "spruce",
}: {
  className?: string;
  tone?: "spruce" | "paper";
}) {
  const stroke = tone === "paper" ? "#FBFAF7" : "#1E4034";
  const mark = tone === "paper" ? "#DDB672" : "#B58B3E";
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 10.6 L12 3.4 L20.5 10.6 V20.5 H3.5 Z"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.6" r="2.1" fill={mark} />
      <path d="M12 14.6 V17.2" stroke={mark} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
