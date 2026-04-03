import type { CSSProperties, ReactNode } from "react";

type SceneFrameProps = {
  accent: string;
  children: ReactNode;
  footerLabel: string;
};

export const SceneFrame = ({ accent, children, footerLabel }: SceneFrameProps) => {
  const shellStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "72px 82px 54px",
    background:
      "radial-gradient(circle at top left, rgba(255,255,255,0.08), transparent 28%), linear-gradient(135deg, #07111f 0%, #0f1d35 52%, #111827 100%)",
    color: "#f8fafc",
    position: "relative",
    overflow: "hidden",
    fontFamily: "SF Pro Display, Inter, sans-serif"
  };

  const glowStyle: CSSProperties = {
    position: "absolute",
    right: -120,
    top: -80,
    width: 420,
    height: 420,
    borderRadius: "50%",
    background: `${accent}30`,
    filter: "blur(28px)"
  };

  const barStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: 18,
    height: "100%",
    background: `linear-gradient(180deg, ${accent}, transparent 76%)`
  };

  return (
    <div style={shellStyle}>
      <div style={glowStyle} />
      <div style={barStyle} />
      <div style={{ position: "relative", zIndex: 1, flex: 1 }}>{children}</div>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid rgba(255,255,255,0.14)",
          paddingTop: 18,
          color: "#cbd5e1",
          fontSize: 22,
          letterSpacing: 0.4
        }}
      >
        <span>STM32 Firmware Tutorial</span>
        <span>{footerLabel}</span>
      </div>
    </div>
  );
};
