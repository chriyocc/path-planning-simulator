import { useEffect, useState } from "react";
import { tutorialScenes } from "../../video/src/content/tutorialData";
import { ControlBar } from "./components/ControlBar";
import { SlideView } from "./components/SlideView";
import { clampSlideIndex, getNextSlideIndex, getPreviousSlideIndex } from "./lib/navigation";

const readIndexFromHash = () => {
  const match = window.location.hash.match(/^#slide-(\d+)$/);
  if (!match) {
    return 0;
  }

  return clampSlideIndex(Number(match[1]) - 1, tutorialScenes.length);
};

export const App = () => {
  const [slideIndex, setSlideIndex] = useState(() => readIndexFromHash());
  const activeSlide = tutorialScenes[slideIndex];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setSlideIndex((current) => getNextSlideIndex(current, tutorialScenes.length));
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setSlideIndex((current) => getPreviousSlideIndex(current, tutorialScenes.length));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setSlideIndex(0);
      }

      if (event.key === "End") {
        event.preventDefault();
        setSlideIndex(tutorialScenes.length - 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    window.location.hash = `slide-${slideIndex + 1}`;
  }, [slideIndex]);

  useEffect(() => {
    const onHashChange = () => {
      setSlideIndex(readIndexFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app-shell">
      <div className="deck-area">
        <div className="deck-meta">
          <div>
            <p className="eyebrow">HTML Slideshow</p>
            <h1>STM32 Firmware Tutorial Slides</h1>
          </div>
          <div className="meta-pill">
            Slide {slideIndex + 1} / {tutorialScenes.length}
          </div>
        </div>

        <SlideView scene={activeSlide} slideIndex={slideIndex} slideCount={tutorialScenes.length} />

        <ControlBar
          slideIndex={slideIndex}
          slideCount={tutorialScenes.length}
          onBack={() => setSlideIndex((current) => getPreviousSlideIndex(current, tutorialScenes.length))}
          onNext={() => setSlideIndex((current) => getNextSlideIndex(current, tutorialScenes.length))}
          onSelect={(index) => setSlideIndex(clampSlideIndex(index, tutorialScenes.length))}
        />
      </div>

      <aside className="presenter-panel">
        <p className="panel-label">Presenter Notes</p>
        <h2>{activeSlide.title}</h2>
        <p className="panel-eyebrow">{activeSlide.eyebrow}</p>
        <ul className="notes-list">
          {activeSlide.body.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {activeSlide.code ? (
          <div className="notes-code">
            <p>Code Callout</p>
            <pre>{activeSlide.code}</pre>
          </div>
        ) : null}
      </aside>
    </div>
  );
};
