export type AppPage = "simulator" | "translator";

export function resolveAppPage(pathname: string): AppPage {
  return pathname === "/translator" ? "translator" : "simulator";
}

export function appPageHref(page: AppPage): string {
  return page === "translator" ? "/translator" : "/";
}
