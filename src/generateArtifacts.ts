import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AdaptiveSafePolicy } from "./policies";
import { createDefaultGraph } from "./map";
import { createDefaultSimulationConfig, simulateRound } from "./simulator";
import { estimateFirmwarePlan, generateFsmContractMarkdown } from "./firmware";

const outDir = join(process.cwd(), "artifacts");
mkdirSync(outDir, { recursive: true });

const graph = createDefaultGraph();
const config = createDefaultSimulationConfig(graph);
const result = simulateRound(config, AdaptiveSafePolicy, 1);
const firmware = estimateFirmwarePlan(result);

writeFileSync(join(outDir, "route_table.json"), JSON.stringify(firmware.route_table, null, 2));
writeFileSync(join(outDir, "policy_rules.json"), JSON.stringify(firmware.policy_rules, null, 2));
writeFileSync(join(outDir, "fsm_contract.md"), generateFsmContractMarkdown());

console.log("Artifacts written to", outDir);
