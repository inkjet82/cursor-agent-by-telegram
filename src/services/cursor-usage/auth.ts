/** Headers for api2.cursor.sh Connect RPC (cookie and/or bearer). */
export function sessionAuthHeaders(sessionToken: string): Record<string, string> {
  const raw = sessionToken.trim();
  const decoded = decodeURIComponent(raw);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
    Origin: "https://cursor.com",
    Referer: "https://cursor.com/dashboard",
    "User-Agent": "cursor-agent-by-telegram/1.0",
  };
  headers.Cookie = `WorkosCursorSessionToken=${decoded}`;
  const parts = decoded.split("::");
  const bearer = parts.length > 1 ? parts.slice(1).join("::") : decoded;
  if (bearer.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  return headers;
}

export function cookieOnlyHeaders(sessionToken: string): Record<string, string> {
  const decoded = decodeURIComponent(sessionToken.trim());
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://cursor.com",
    Referer: "https://cursor.com/dashboard",
    Cookie: `WorkosCursorSessionToken=${decoded}`,
    "User-Agent": "cursor-agent-by-telegram/1.0",
  };
}
