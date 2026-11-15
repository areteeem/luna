import { hosted } from "./runtime";

type ScienceEndpoint = "/api/geometry" | "/api/recommendations" | "/api/routes";

/** The local installer and hosted navigator use the same study/result contracts. */
export function scienceRequest(endpoint: ScienceEndpoint, init: RequestInit) {
  if (hosted && endpoint !== "/api/geometry") {
    return Promise.resolve(Response.json({
      error: "Terrain-based science tools are available in the installed editor.",
    }, { status: 503 }));
  }
  return fetch(endpoint, init);
}
