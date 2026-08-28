export interface Actor { email: string; name: string; role: "Admin" | "Staff"; }

export function getActor(req: Request): Actor | null {
  const mode = Netlify.env.get("APP_AUTH_MODE") || "production";
  if (mode === "development") {
    const email = Netlify.env.get("DEV_ADMIN_EMAIL") || "";
    if (!email) return null;
    return { email, name: "Development Admin", role: "Admin" };
  }
  // Google Identity Services verification will replace this production branch.
  // Until then production mode deliberately denies access rather than trusting browser headers.
  void req;
  return null;
}
