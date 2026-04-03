import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type BulletListProps = {
  items: string[];
  accent: string;
  columns?: 1 | 2;
  checklist?: boolean;
};

export const BulletList = ({
  items,
  accent,
  columns = 1,
  checklist = false
}: BulletListProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns === 2 ? "repeat(2, minmax(0, 1fr))" : "1fr",
        gap: 18,
        marginTop: 34
      }}
    >
      {items.map((item, index) => {
        const localFrame = Math.max(0, frame - index * 7);
        const entrance = spring({ fps, frame: localFrame, config: { damping: 100 } });
        const opacity = interpolate(localFrame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

        return (
          <div
            key={item}
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(15, 23, 42, 0.72)",
              borderRadius: 24,
              padding: "22px 24px",
              transform: `translateY(${(1 - entrance) * 18}px)`,
              opacity
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: checklist ? 6 : 999,
                marginTop: 9,
                background: accent,
                boxShadow: `0 0 24px ${accent}`
              }}
            />
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.32,
                color: "#e2e8f0"
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
};
