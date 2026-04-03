import { describe, expect, test } from "vitest";
import { getTutorialDurationInFrames, tutorialScenes } from "../src/content/tutorialData";
import { buildSceneTimings, framesFromSeconds } from "../src/lib/timing";

describe("tutorial timing helpers", () => {
  test("converts seconds to frames", () => {
    expect(framesFromSeconds(2.5, 30)).toBe(75);
  });

  test("builds sequential scene timings without gaps", () => {
    const timings = buildSceneTimings(
      [
        {
          id: "a",
          title: "A",
          eyebrow: "One",
          durationInSeconds: 2,
          kind: "bullets",
          body: ["alpha"],
          accent: "#ff0000"
        },
        {
          id: "b",
          title: "B",
          eyebrow: "Two",
          durationInSeconds: 3,
          kind: "flow",
          body: ["beta"],
          accent: "#00ff00"
        }
      ],
      30
    );

    expect(timings).toEqual([
      { id: "a", from: 0, durationInFrames: 60 },
      { id: "b", from: 60, durationInFrames: 90 }
    ]);
  });

  test("ships the full tutorial scene set", () => {
    expect(tutorialScenes).toHaveLength(16);
    expect(getTutorialDurationInFrames(30)).toBeGreaterThan(0);
    expect(tutorialScenes.every((scene) => scene.body.length > 0)).toBe(true);
  });
});
