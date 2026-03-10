import { describe, expect, it } from "vitest";
import { appPageHref, resolveAppPage } from "../src/appRoutes";
import {
  buildTutorialExecution,
  buildPlanForPlacement,
  createDefaultTutorialPlacement,
  decodePlanAction,
  findLayoutIdForPlacement,
  parsePlanRowText,
  renderTutorialSteps,
  validatePlacementRows
} from "../src/translator";

describe("translator helpers", () => {
  it("resolves the translator path separately from the simulator", () => {
    expect(resolveAppPage("/", "")).toBe("simulator");
    expect(resolveAppPage("/translator", "")).toBe("translator");
    expect(resolveAppPage("/path-planning-simulator/translator", "")).toBe("translator");
    expect(resolveAppPage("/anything-else", "")).toBe("simulator");
  });

  it("uses clean path-based hrefs while preserving the github pages repo base", () => {
    expect(appPageHref("simulator")).toBe("/");
    expect(appPageHref("translator")).toBe("/translator");
    expect(appPageHref("translator", "/path-planning-simulator/")).toBe("/path-planning-simulator/translator");
  });

  it("finds the expected layout id for the default tutorial placement", () => {
    expect(findLayoutIdForPlacement(createDefaultTutorialPlacement())).toBe(0);
  });

  it("rejects invalid manual placements with duplicate row colors", () => {
    expect(
      validatePlacementRows({
        RED: ["RED", "RED"],
        YELLOW: ["RED", "YELLOW"],
        BLUE: ["BLUE", "BLUE"],
        GREEN: ["GREEN", "GREEN"]
      })
    ).toContain("Row 1 must contain RED, YELLOW, BLUE, and GREEN exactly once.");
  });

  it("builds a tutorial plan for a valid placement", () => {
    const plan = buildPlanForPlacement(createDefaultTutorialPlacement());
    expect(plan.action_count).toBeGreaterThan(0);
    expect(plan.actions.length).toBe(plan.action_count);
  });

  it("decodes branch and slot ids into beginner-friendly explanations", () => {
    expect(decodePlanAction({ type: "ACT_PICK_RESOURCE", arg0: 3, arg1: 1 })).toEqual({
      raw: "ACT_PICK_RESOURCE, 3, 1",
      decoded: "branch 3 = GREEN, slot 1 = second slot",
      meaning: "Pick the second slot resource from GREEN branch.",
      targetNode: "NODE_R_GREEN_2",
      routeConnection: "Firmware maps this action to NODE_R_GREEN_2, then looks up g_route_table[current_node][NODE_R_GREEN_2]."
    });
  });

  it("builds a sequential tutorial route lookup with actual g_route_table content", () => {
    const execution = buildTutorialExecution({
      action_count: 2,
      actions: [
        { type: "ACT_PICK_LOCK", arg0: 1, arg1: 0 },
        { type: "ACT_RETURN_START", arg0: 0, arg1: 0 }
      ]
    });

    expect(execution[0].currentNode).toBe("NODE_START");
    expect(execution[0].routeLookup).toBe("g_route_table[NODE_START][NODE_LOCK_YELLOW]");
    expect(execution[0].routeEntry).toContain("valid = 1");
    expect(execution[0].routeEntry).toContain("step_count = ");
    expect(execution[0].routeEntry).toContain("steps = ");
    expect(execution[1].currentNode).toBe("NODE_LOCK_YELLOW");
    expect(execution[1].routeLookup).toBe("g_route_table[NODE_LOCK_YELLOW][NODE_START]");
  });

  it("renders translated steps from a pasted row and ignores padded end-round actions after action_count", () => {
    const parsed = parsePlanRowText(
      "{ .action_count = 2, .actions = { { ACT_PICK_LOCK, 0, 0 }, { ACT_RETURN_START, 0, 0 }, { ACT_END_ROUND, 0, 0 } } }"
    );
    const steps = renderTutorialSteps(parsed);
    expect(parsed.action_count).toBe(2);
    expect(steps).toHaveLength(2);
    expect(steps[0].meaning).toBe("Pick the RED branch black lock.");
    expect(steps[1].meaning).toBe("Return to START.");
  });

  it("rejects malformed pasted rows clearly", () => {
    expect(() => parsePlanRowText("not a c row")).toThrow("No C actions were found");
  });
});
