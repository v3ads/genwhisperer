import { useId } from "react";

/** GenWhisperer mark: prompt brackets + whisper wave + emitter dot. */
export function Mark({ size = 30, tile = true }: { size?: number; tile?: boolean }) {
  const id = useId();
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22c3e6" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      {tile && (
        <>
          <rect width="256" height="256" rx="58" fill="#101c30" />
          <rect x="1.5" y="1.5" width="253" height="253" rx="56.5" fill="none" stroke="#22344f" strokeWidth="3" />
        </>
      )}
      <path d="M96 70 H66 a12 12 0 0 0 -12 12 V174 a12 12 0 0 0 12 12 H96" fill="none" stroke={`url(#${id})`} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M160 70 H190 a12 12 0 0 1 12 12 V174 a12 12 0 0 1 -12 12 H160" fill="none" stroke={`url(#${id})`} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M96 146 q32 -16 64 0" stroke={`url(#${id})`} strokeWidth="22" strokeLinecap="round" fill="none" />
      <circle cx="128" cy="100" r="15" fill="#eaf0f8" />
    </svg>
  );
}

export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={`brand${large ? " lg" : ""}`}>
      <Mark size={large ? 38 : 30} />
      Gen<b>Whisperer</b>
    </div>
  );
}
