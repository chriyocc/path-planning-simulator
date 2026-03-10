export type AppPage = "simulator" | "translator";

export function resolveAppPage(pathname: string): AppPage {
  return pathname === "/translator" ? "translator" : "simulator";
}
