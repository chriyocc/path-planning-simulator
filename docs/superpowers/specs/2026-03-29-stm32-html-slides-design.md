# STM32 HTML Slides Design

## Summary

Add a separate `slides/` subproject that renders the STM32 firmware tutorial as a browser-based slideshow with keyboard navigation and print-friendly 16:9 slides.

## Decision

Use a standalone Vite + React slideshow app instead of embedding slides into the simulator or the Remotion project.

## Why

- Keeps the slideshow workflow independent from the simulator and video renderer.
- Makes it easy to present in a browser and export to PDF later.
- Reuses the same tutorial structure as the video without forcing slide logic into the video code.

## Architecture

- Root `package.json` gets `slides:*` scripts.
- `slides/` contains its own package, Vite config, TypeScript config, app shell, and tests.
- Slide content imports the existing tutorial scene data from `video/src/content/tutorialData.ts`.
- A small helper module owns index clamping and keyboard-driven navigation behavior.

## UX

- One slide visible at a time
- Arrow keys and on-screen buttons
- Progress indicator
- Print-friendly layout
- Presenter panel showing bullets and optional code when useful

## Verification

- Test navigation helpers
- Build the slideshow app
- Confirm slide count matches the tutorial scene count
