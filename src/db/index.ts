import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon's HTTP driver fails the whole query on a transient connect timeout; retry network errors a couple of times.
neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
};

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
export * from "./schema";
