import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type SceneTitleProps = {
  eyebrow: string;
  title: string;
  accent: string;
};

export const SceneTitle = ({ eyebrow, title, accent }: SceneTitleProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ fps, frame, config: { damping: 200 } });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        transform: `translateY(${(1 - rise) * 36}px)`,
        opacity
      }}
    >
      <div
        style={{
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 3.2,
          fontSize: 24,
          fontWeight: 700,
          marginBottom: 18
        }}
      >
        {eyebrow}
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 70,
          lineHeight: 1.02,
          maxWidth: 1180,
          fontWeight: 800
        }}
      >
        {title}
      </h1>
    </div>
  );
};
