import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BulletList } from "../components/BulletList";
import { CodeCard } from "../components/CodeCard";
import { FlowDiagram } from "../components/FlowDiagram";
import { SceneFrame } from "../components/SceneFrame";
import { SceneTitle } from "../components/SceneTitle";
import type { TutorialScene } from "../content/tutorialData";
import { buildSceneTimings } from "../lib/timing";

export type Stm32FirmwareTutorialProps = {
  scenes: TutorialScene[];
};

const SceneBody = ({ scene }: { scene: TutorialScene }) => {
  if (scene.kind === "title") {
    return (
      <div style={{ marginTop: 42 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 18,
            maxWidth: 980
          }}
        >
          {scene.body.map((item) => (
            <div
              key={item}
              style={{
                borderRadius: 24,
                border: `1px solid ${scene.accent}55`,
                background: "rgba(15, 23, 42, 0.7)",
                padding: "22px 24px",
                fontSize: 30,
                color: "#e2e8f0",
                boxShadow: `0 14px 30px ${scene.accent}14`
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (scene.kind === "flow") {
    return <FlowDiagram steps={scene.body} accent={scene.accent} compact={scene.body.length > 5} />;
  }

  if (scene.kind === "code" && scene.code) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.15fr 0.95fr",
          gap: 28,
          alignItems: "start",
          marginTop: 18
        }}
      >
        <CodeCard code={scene.code} accent={scene.accent} />
        <BulletList items={scene.body} accent={scene.accent} />
      </div>
    );
  }

  return (
    <BulletList
      items={scene.body}
      accent={scene.accent}
      columns={scene.body.length > 4 ? 2 : 1}
      checklist={scene.kind === "checklist"}
    />
  );
};

const Scene = ({ scene, index, total }: { scene: TutorialScene; index: number; total: number }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(
    frame,
    [0, 8, durationInFrames - 10, durationInFrames - 1],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneFrame accent={scene.accent} footerLabel={`${index + 1} / ${total}`}>
        <SceneTitle eyebrow={scene.eyebrow} title={scene.title} accent={scene.accent} />
        <SceneBody scene={scene} />
      </SceneFrame>
    </AbsoluteFill>
  );
};

export const Stm32FirmwareTutorial = ({ scenes }: Stm32FirmwareTutorialProps) => {
  const { fps } = useVideoConfig();
  const timings = buildSceneTimings(scenes, fps);

  return (
    <AbsoluteFill>
      {timings.map((timing, index) => (
        <Sequence key={timing.id} from={timing.from} durationInFrames={timing.durationInFrames}>
          <Scene scene={scenes[index]} index={index} total={scenes.length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
