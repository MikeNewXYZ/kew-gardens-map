import { Agent, routeAgentRequest } from "agents";

export { PresenceAgent } from "./presence.ts";

export interface SavedPlant {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

/**
 * A stateful Durable Object built on the Agents SDK. The "Agents SDK" here is
 * used purely as a Durable Object framework (state + embedded SQLite + routing)
 * — there is no LLM involved.
 *
 * Each instance is an isolated plant collection, keyed by the name in the URL:
 *   /agents/plant-collection-agent/<collection-name>
 * Saved plants persist in the Agent's per-instance SQLite database.
 */
export class PlantCollectionAgent extends Agent<Env> {
  // Runs once when the Durable Object is first created.
  async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS saved_plants (
        id   TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lng  REAL NOT NULL,
        lat  REAL NOT NULL
      )
    `;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (request.method) {
      case "GET": {
        const plants = this
          .sql<SavedPlant>`SELECT * FROM saved_plants ORDER BY name`;
        return Response.json(plants);
      }

      case "POST": {
        const p = (await request.json()) as Partial<SavedPlant>;
        if (!p?.id || !p?.name) {
          return Response.json(
            { error: "id and name are required" },
            { status: 400 },
          );
        }
        this.sql`
          INSERT INTO saved_plants (id, name, lng, lat)
          VALUES (${p.id}, ${p.name}, ${p.lng ?? 0}, ${p.lat ?? 0})
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, lng = excluded.lng, lat = excluded.lat
        `;
        return Response.json({ ok: true });
      }

      case "DELETE": {
        const id = url.searchParams.get("id");
        if (!id) {
          return Response.json(
            { error: "id query param required" },
            { status: 400 },
          );
        }
        this.sql`DELETE FROM saved_plants WHERE id = ${id}`;
        return Response.json({ ok: true });
      }

      default:
        return new Response("Method not allowed", { status: 405 });
    }
  }
}

export default {
  async fetch(request, env) {
    // `/agents/*` reaches the Worker first (run_worker_first in wrangler.jsonc)
    // and is dispatched to the Durable Object above. Everything else is the
    // static SPA, served through the assets binding with SPA fallback routing.
    return (
      (await routeAgentRequest(request, env)) ?? env.ASSETS.fetch(request)
    );
  },
} satisfies ExportedHandler<Env>;
