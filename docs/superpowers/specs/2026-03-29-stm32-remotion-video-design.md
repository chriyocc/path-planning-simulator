# STM32 Remotion Video Design

## Summary

Add a separate Remotion subproject for the STM32 firmware tutorial video so the repository can preview and render a polished tutorial locally without mixing video-specific dependencies into the main simulator app.

## Decision

Use a standalone `video/` subproject instead of embedding Remotion inside the existing Vite app.

## Why This Design

- Keeps the simulator app isolated from video tooling and React-specific dependencies.
- Makes preview and render workflows explicit and reproducible.
- Lets the tutorial evolve independently as a media artifact.
- Keeps the already-authored tutorial package as the content source of truth.

## Architecture

### Root repo

- Keep the current simulator package intact.
- Add root scripts that proxy into the subproject using `npm --prefix video`.

### Video subproject

- `video/package.json`: Remotion dependencies and scripts
- `video/tsconfig.json`: local TypeScript config for the video app
- `video/remotion.config.ts`: output and rendering defaults
- `video/src/index.ts`: Remotion register root entry
- `video/src/Root.tsx`: composition definitions
- `video/src/compositions/Stm32FirmwareTutorial.tsx`: main composition
- `video/src/content/tutorialData.ts`: typed scene content and durations
- `video/src/lib/timing.ts`: frame and sequence helpers
- `video/src/components/*`: reusable scene primitives
- `video/tests/*`: tests for pure helpers and content integrity

## Video Design

The first rendered version is a silent animated explainer driven by text, diagrams, and code callouts.

Scenes:

1. Title
2. Big picture pipeline
3. Generated file roles
4. Layout table
5. Plan table
6. Route table
7. Firmware architecture
8. Runtime state
9. Core lookup sequence
10. Action decoding
11. Match FSM
12. Known-layout bring-up
13. Full inference path
14. End-to-end action example
15. Safety and fallback
16. Closing checklist

## Motion Principles

- Only Remotion frame-driven animation
- No CSS transitions
- Slow staggered reveals for code and list items
- Strong visual separation between layout, plan, route, and runtime-state concepts

## Verification

- Add tests for scene-duration math and content structure.
- Run the video subproject test suite.
- Render one local mp4 successfully from the new script path.
