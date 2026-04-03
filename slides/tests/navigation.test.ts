import { describe, expect, test } from "vitest";
import { tutorialScenes } from "../../video/src/content/tutorialData";
import {
  clampSlideIndex,
  getNextSlideIndex,
  getPreviousSlideIndex
} from "../src/lib/navigation";

describe("slide navigation helpers", () => {
  test("clamps indexes to the valid range", () => {
    expect(clampSlideIndex(-2, 16)).toBe(0);
    expect(clampSlideIndex(3, 16)).toBe(3);
    expect(clampSlideIndex(99, 16)).toBe(15);
  });

  test("advances but does not overflow", () => {
    expect(getNextSlideIndex(0, 16)).toBe(1);
    expect(getNextSlideIndex(15, 16)).toBe(15);
  });

  test("moves backward but does not underflow", () => {
    expect(getPreviousSlideIndex(7, 16)).toBe(6);
    expect(getPreviousSlideIndex(0, 16)).toBe(0);
  });

  test("matches the tutorial slide count", () => {
    expect(tutorialScenes).toHaveLength(16);
    expect(clampSlideIndex(999, tutorialScenes.length)).toBe(tutorialScenes.length - 1);
  });
});
