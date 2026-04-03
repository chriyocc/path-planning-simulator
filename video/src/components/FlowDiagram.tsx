import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type FlowDiagramProps = {
  steps: string[];
  accent: string;
  compact?: boolean;
};

export const FlowDiagram = ({ steps, accent, compact = false }: FlowDiagramProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: compact ? 16 : 20,
        marginTop: 34
      }}
    >
      {steps.map((step, index) => {
        const localFrame = Math.max(0, frame - index * 6);
        const entrance = spring({ fps, frame: localFrame, config: { damping: 100 } });
        const opacity = interpolate(localFrame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

        return (
          <div
            key={`${step}-${index}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: compact ? 10 : 14,
              transform: `translateY(${(1 - entrance) * 16}px)`,
              opacity
            }}
          >
            <div
              style={{
                minWidth: compact ? 230 : 280,
                maxWidth: compact ? 260 : 320,
                padding: compact ? "16px 18px" : "18px 20px",
                borderRadius: 22,
                background: "rgba(15, 23, 42, 0.78)",
                border: `1px solid ${accent}55`,
                color: "#f8fafc",
                fontWeight: 650,
                fontSize: compact ? 24 : 28,
                lineHeight: 1.25,
                boxShadow: `0 12px 32px ${accent}16`
              }}
            >
              {step}
            </div>
            {index < steps.length - 1 ? (
              <div
                style={{
                  color: accent,
                  fontSize: compact ? 28 : 34,
                  fontWeight: 800
                }}
              >
                →
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
