import { flowTier, flows, watts } from "../models";
import type { Live } from "../models";

const positions: Record<string, [number, number]> = {
  Solar: [160, 40],
  Grid: [30, 150],
  Battery: [290, 150],
  Inverter: [160, 150],
  Home: [160, 270],
};

export function EnergyFlow({ live, stale }: { live: Live; stale: boolean }) {
  const animate =
    !stale &&
    live.freshness === "LIVE" &&
    live.ageSeconds != null &&
    live.ageSeconds <= 30;
  return (
    <svg
      className={`energy-flow ${animate ? "flow-live" : ""}`}
      viewBox="0 0 320 310"
      role="img"
      aria-label="Current energy flow between solar, grid, battery, inverter and home"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="context-stroke" />
        </marker>
      </defs>
      {flows(live).map((flow) => {
        const [x1, y1] = positions[flow.from]!;
        const [x2, y2] = positions[flow.to]!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        const trim = 30 / length;
        const tier = flowTier(flow.watts);
        return (
          <g
            key={`${flow.from}-${flow.to}`}
            className={`flow-edge flow-${tier}`}
          >
            <line
              x1={x1 + dx * trim}
              y1={y1 + dy * trim}
              x2={x2 - dx * trim}
              y2={y2 - dy * trim}
              markerEnd="url(#arrow)"
            />
            <text
              x={(x1 + x2) / 2 + (dy === 0 ? 0 : 32)}
              y={(y1 + y2) / 2 - 6}
              textAnchor="middle"
            >
              {watts(flow.watts)}
            </text>
            {flow.watts == null && <title>{flow.reason ?? "NO_READING"}</title>}
          </g>
        );
      })}
      {Object.entries(positions).map(([name, [x, y]]) => (
        <g key={name} className="flow-node">
          <circle cx={x} cy={y} r="29" />
          <text x={x} y={y + 4} textAnchor="middle">
            {name}
          </text>
        </g>
      ))}
    </svg>
  );
}
