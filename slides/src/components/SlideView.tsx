import type { TutorialScene } from "../../../video/src/content/tutorialData";

type SlideViewProps = {
  scene: TutorialScene;
  slideIndex: number;
  slideCount: number;
};

const renderBody = (scene: TutorialScene) => {
  if (scene.kind === "flow") {
    return (
      <div className="flow-grid">
        {scene.body.map((item, index) => (
          <div className="flow-step" key={`${scene.id}-${item}`}>
            <span>{item}</span>
            {index < scene.body.length - 1 ? <strong>→</strong> : null}
          </div>
        ))}
      </div>
    );
  }

  if (scene.kind === "title") {
    return (
      <div className="title-stack">
        {scene.body.map((item) => (
          <div className="title-card" key={item}>
            {item}
          </div>
        ))}
      </div>
    );
  }

  return (
    <ul className={`slide-list ${scene.kind === "checklist" ? "is-checklist" : ""}`}>
      {scene.body.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
};

export const SlideView = ({ scene, slideIndex, slideCount }: SlideViewProps) => {
  return (
    <section className="slide-frame" style={{ ["--slide-accent" as string]: scene.accent }}>
      <div className="slide-header">
        <div>
          <p className="slide-eyebrow">{scene.eyebrow}</p>
          <h2>{scene.title}</h2>
        </div>
        <div className="slide-counter">
          {slideIndex + 1} / {slideCount}
        </div>
      </div>

      <div className="slide-body">
        {scene.code ? (
          <div className="code-layout">
            <div className="code-card">
              <pre>{scene.code}</pre>
            </div>
            {renderBody(scene)}
          </div>
        ) : (
          renderBody(scene)
        )}
      </div>
    </section>
  );
};
