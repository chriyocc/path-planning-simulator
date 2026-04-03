# STM32 Firmware Tutorial Render Checklist

Use this checklist when turning the tutorial package into a video later.

## Inputs

- `docs/stm32_firmware_tutorial_video_package.md`
- `docs/stm32_firmware_tutorial_voiceover.srt`
- `docs/stm32_firmware_implementation_guide.md`
- `generated/stm32/generated_layouts.h`
- `generated/stm32/generated_plan_table.h`
- `generated/stm32/generated_plan_table_lifo.h`
- `generated/stm32/generated_routes.h`

## Shot Preparation

1. Capture clean cropped screenshots of the generated header symbols:
   - `g_layouts`
   - `g_plan_table`
   - `g_plan_table_lifo`
   - `g_route_table`
2. Build one simple planner-to-firmware pipeline diagram.
3. Build one action decoding graphic.
4. Build one match FSM graphic.
5. Build one layout inference candidate-filtering graphic.

## Editing Guidance

1. Keep slides on screen long enough for embedded code readers to parse the symbols.
2. Use progressive highlights instead of dropping full code blocks at once.
3. Keep terminology consistent:
   - `layout_id`
   - `plan_step_index`
   - `target_node`
   - `route`
4. Distinguish these concepts visually:
   - layout data
   - action data
   - route data
   - runtime state
5. Treat `ACT_DROP_LOCK` as a special case in both visuals and narration.

## Suggested Output Package

- `mp4` tutorial render
- optional captions from the `.srt`
- optional PDF export of slides

## Quality Check Before Export

1. Verify the narration never implies the generated files are direct motor commands.
2. Verify the known-layout bring-up path appears before full layout inference.
3. Verify the route table is described as navigation decisions, not speed commands.
4. Verify the final checklist includes both plan decoding and logical state updates.
