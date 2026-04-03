import { interpolate, useCurrentFrame } from "remotion";

type CodeCardProps = {
  code: string;
  accent: string;
};

export const CodeCard = ({ code, accent }: CodeCardProps) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [6, 16], [0, 1], { extrapolateLeft: "clamp" });

  return (
    <div
      style={{
        marginTop: 30,
        borderRadius: 28,
        border: `1px solid ${accent}50`,
        background: "rgba(2, 6, 23, 0.9)",
        overflow: "hidden",
        boxShadow: `0 18px 48px ${accent}18`,
        opacity
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 22px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <div
            key={color}
            style={{ width: 14, height: 14, borderRadius: "50%", background: color }}
          />
        ))}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "26px 28px",
          color: "#e2e8f0",
          fontSize: 27,
          lineHeight: 1.5,
          fontFamily: "SFMono-Regular, Menlo, monospace",
          whiteSpace: "pre-wrap"
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};
