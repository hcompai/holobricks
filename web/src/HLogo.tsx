export function HLogo({ height = 18 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 1035 600" fill="currentColor" role="img" aria-label="H Company">
      <circle cx="300" cy="300" r="300" />
      <rect x="838" y="195" width="54" height="220" />
      <rect x="1035" y="282" width="45" height="197" transform="rotate(90 1035 282)" />
      <rect x="981" y="195" width="54" height="220" />
    </svg>
  );
}
