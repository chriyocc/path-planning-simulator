export type AppPage = "simulator" | "translator";

export function resolveAppPage(pathname: string, hash = ""): AppPage {
  const normalizedPath = pathname.replace(/\/+$/, "");
  if (normalizedPath === "/translator" || normalizedPath.endsWith("/translator")) {
    return "translator";
  }
  const normalizedHash = hash.replace(/^#/, "");
  if (normalizedHash === "/translator" || normalizedHash === "translator") {
    return "translator";
  }
  return "simulator";
}

export function appPageHref(page: AppPage, base = "/"): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return page === "translator" ? `${normalizedBase}translator` : normalizedBase;
}
