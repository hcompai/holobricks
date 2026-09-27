export function BrickLoader({ label }: { label: string }) {
  return (
    <div className="loader" role="status">
      <img className="brick-hop" src="/brick.png" alt="" />
      <div className="brick-shadow" />
      <span className="shimmer">{label}</span>
    </div>
  );
}
