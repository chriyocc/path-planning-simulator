import { defineConfig } from "vite";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "path-planning-simulator";
const base = process.env.GITHUB_ACTIONS ? `/${repoName}/` : "/";

export default defineConfig({
  base,
  test: {
    environment: "node"
  }
});
