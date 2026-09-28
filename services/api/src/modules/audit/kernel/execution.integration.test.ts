import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, type Fixture } from "../integration-fixture";
import { Refusal, runCommand, runQuery } from "./index";

const integration =
  process.env.AQARAK_INTEGRATION === "1" ? describe : describe.skip;
integration(
  "request subjects and company lock boundaries",
  { timeout: 60000 },
  () => {
    let fixture: Fixture;
    beforeAll(async () => {
      expect(["aqarak_tawtheeq", "aqarak_integration"]).toContain(
        process.env.DATABASE_NAME,
      );
      fixture = await createFixture();
    }, 180000);
    afterAll(async () => {
      await fixture.close();
    });

    it("returns infrastructure outages without a policy denial", async () => {
      const count = async () =>
        fixture.tx((tx) =>
          tx.execute(
            "select count(*) as count from audit.audit_event where event_type='policy.denied'",
          ),
        );
      const before = await count();
      const app = new Hono();
      app.get("/v1/companies/:companyId/audit/outage", (c) =>
        runQuery(c, fixture.deps, {
          authorize: () => null,
          execute: () => Promise.reject(new Refusal("UNAVAILABLE", null)),
        }),
      );
      expect(
        (await fixture.request("/outage", { application: app })).status,
      ).toBe(503);
      expect(await count()).toEqual(before);
    });

    it("serves a query while another transaction holds the company command lock", async () => {
      const app = new Hono();
      app.get("/v1/companies/:companyId/audit/read-lock", (c) =>
        runQuery(c, fixture.deps, {
          authorize: () => null,
          execute: () => Promise.resolve({ read: true }),
        }),
      );
      const acquired = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<undefined>();
      const holding = fixture.tx(async (tx) => {
        await tx.execute(
          "select id from core.company where id=:company::uuid for update",
          [{ name: "company", value: fixture.companyId }],
        );
        acquired.resolve(undefined);
        await release.promise;
      });
      void holding.catch(acquired.reject);
      await acquired.promise;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const reading = fixture.request("/read-lock", { application: app });
      try {
        const response = await Promise.race([
          reading,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("Query waited for the company command lock"));
            }, 15000);
          }),
        ]);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ read: true });
      } finally {
        if (timer) clearTimeout(timer);
        release.resolve(undefined);
        await holding;
        await reading;
      }
    });

    it.each(["query", "command"] as const)(
      "keeps an explicit refusal subject ahead of the %s fallback",
      async (mode) => {
        const fallback = { type: "tawtheeq_record", id: randomUUID() };
        const explicit = { type: "document", id: randomUUID() };
        const app = new Hono();
        app.all("/v1/companies/:companyId/audit/precedence", (c) => {
          const spec = {
            subject: fallback,
            authorize: () => new Refusal("NOT_PERMITTED", explicit),
          };
          return mode === "query"
            ? runQuery(c, fixture.deps, {
                ...spec,
                execute: () => Promise.resolve({}),
              })
            : runCommand(c, fixture.deps, {
                ...spec,
                commandType: "test.precedence",
                body: {},
                execute: () => Promise.resolve({ status: 200, body: {} }),
              });
        });
        const response = await fixture.request("/precedence", {
          application: app,
          method: mode === "command" ? "POST" : "GET",
          key: randomUUID(),
        });
        expect(response.status).toBe(403);
        const event = await fixture.tx(async (tx) =>
          tx.execute(
            "select subject_type,subject_id from audit.audit_event where company_id=:company::uuid order by seq desc limit 1",
            [{ name: "company", value: fixture.companyId }],
          ),
        );
        expect(event.rows[0]).toEqual({
          subject_type: explicit.type,
          subject_id: explicit.id,
        });
      },
    );

    it("names the audit subject on a refusal before route execution", async () => {
      const subject = { type: "document", id: randomUUID() };
      const response = await fixture.request(
        `/subjects/${subject.type}/${subject.id}/versions`,
        { role: "tenant" },
      );
      expect(response.status).toBe(403);
      const event = await fixture.tx(async (tx) =>
        tx.execute(
          "select subject_type,subject_id from audit.audit_event where company_id=:company::uuid order by seq desc limit 1",
          [{ name: "company", value: fixture.companyId }],
        ),
      );
      expect(event.rows[0]).toEqual({
        subject_type: subject.type,
        subject_id: subject.id,
      });
    });

    it("retains the company lock for commands", async () => {
      const locks: string[] = [];
      const database = fixture.deps.database;
      const deps = {
        ...fixture.deps,
        database: {
          ...database,
          execute(
            sql: string,
            ...rest: Parameters<typeof database.execute> extends [
              string,
              ...infer Rest,
            ]
              ? Rest
              : never
          ) {
            if (sql.includes("select id from core.company")) locks.push(sql);
            return database.execute(sql, ...rest);
          },
        },
      };
      const app = new Hono();
      app.post("/v1/companies/:companyId/audit/command-lock", (c) =>
        runCommand(c, deps, {
          commandType: "test.lock",
          body: {},
          authorize: () => null,
          execute: () => Promise.resolve({ status: 200, body: {} }),
        }),
      );
      expect(
        (
          await fixture.request("/command-lock", {
            application: app,
            method: "POST",
            key: randomUUID(),
          })
        ).status,
      ).toBe(200);
      expect(locks).toHaveLength(1);
      expect(locks[0]).toMatch(/for update$/);
    });
  },
);
