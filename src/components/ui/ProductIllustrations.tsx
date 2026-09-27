export function CreationEmptyIllustration({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 380 250" role="img" aria-label="视频、脚本和时间轴组成的创作示意图" className={className}>
      <path d="M45 199c39 23 234 26 297-3" fill="none" stroke="#d8def8" strokeWidth="3" strokeLinecap="round"/>
      <rect x="55" y="38" width="238" height="166" rx="22" fill="#fff" stroke="#10244a" strokeWidth="7"/>
      <path d="M55 72h238" stroke="#10244a" strokeWidth="7"/>
      <circle cx="76" cy="55" r="5" fill="#2fd1c5" stroke="#10244a" strokeWidth="3"/>
      <circle cx="94" cy="55" r="5" fill="#8b7cf6" stroke="#10244a" strokeWidth="3"/>
      <rect x="77" y="91" width="116" height="69" rx="12" fill="#8b7cf6" stroke="#10244a" strokeWidth="5"/>
      <path d="m120 110 30 16-30 17Z" fill="#fff" stroke="#10244a" strokeWidth="4" strokeLinejoin="round"/>
      <path d="M211 100h56M211 117h42M211 134h50" stroke="#10244a" strokeWidth="5" strokeLinecap="round"/>
      <path d="M77 178h190" stroke="#10244a" strokeWidth="5" strokeLinecap="round"/>
      {[83,119,155,191,227].map((x, index) => <rect key={x} x={x} y="169" width="27" height="18" rx="4" fill={index % 2 ? '#c9c3ff' : '#8fe4d8'} stroke="#10244a" strokeWidth="3"/>)}
      <circle cx="191" cy="178" r="8" fill="#2fd1c5" stroke="#10244a" strokeWidth="4"/>
      <rect x="247" y="104" width="89" height="114" rx="14" fill="#fff" stroke="#10244a" strokeWidth="6" transform="rotate(6 247 104)"/>
      <path d="m267 132 45 5M265 151l42 5M263 170l34 4M261 189l27 3" stroke="#8b7cf6" strokeWidth="6" strokeLinecap="round"/>
      <path d="m307 54 8-21 8 21 21 8-21 8-8 21-8-21-21-8Z" fill="#2fd1c5" stroke="#10244a" strokeWidth="6" strokeLinejoin="round"/>
    </svg>
  );
}
