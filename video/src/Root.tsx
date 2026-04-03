import { Composition } from "remotion";
import { Stm32FirmwareTutorial } from "./compositions/Stm32FirmwareTutorial";
import { getTutorialDurationInFrames, tutorialScenes } from "./content/tutorialData";

export const RemotionRoot = () => {
  return (
    <Composition
      id="stm32-firmware-tutorial"
      component={Stm32FirmwareTutorial}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={getTutorialDurationInFrames(30)}
      defaultProps={{ scenes: tutorialScenes }}
    />
  );
};
