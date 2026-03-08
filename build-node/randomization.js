import seedrandom from "seedrandom";
const BRANCHES = ["RED", "YELLOW", "BLUE", "GREEN"];
export function randomizeRound(seed) {
    const rng = seedrandom(String(seed));
    const pool = ["RED", "RED", "YELLOW", "YELLOW", "BLUE", "BLUE", "GREEN", "GREEN"];
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const branch_to_resources = {};
    BRANCHES.forEach((branchId, index) => {
        branch_to_resources[branchId] = [pool[index * 2], pool[index * 2 + 1]];
    });
    return { branch_to_resources };
}
