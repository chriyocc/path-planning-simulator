export const clampSlideIndex = (index: number, slideCount: number): number => {
  if (slideCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), slideCount - 1);
};

export const getNextSlideIndex = (index: number, slideCount: number): number => {
  return clampSlideIndex(index + 1, slideCount);
};

export const getPreviousSlideIndex = (index: number, slideCount: number): number => {
  return clampSlideIndex(index - 1, slideCount);
};
