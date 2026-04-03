import type { TutorialScene } from "../content/tutorialData";

export type SceneTiming = {
  id: string;
  from: number;
  durationInFrames: number;
};

export const framesFromSeconds = (seconds: number, fps: number): number => {
  return Math.round(seconds * fps);
};

export const buildSceneTimings = (scenes: TutorialScene[], fps: number): SceneTiming[] => {
  let cursor = 0;

  return scenes.map((scene) => {
    const durationInFrames = framesFromSeconds(scene.durationInSeconds, fps);
    const timing = {
      id: scene.id,
      from: cursor,
      durationInFrames
    };

    cursor += durationInFrames;
    return timing;
  });
};
