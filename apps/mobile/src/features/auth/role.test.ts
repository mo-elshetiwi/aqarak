import { resolveMobileRole, roleTabs } from "./role";
describe("AC-14 capacity-based navigation", () => {
  it("applies manager then technician then owner then tenant precedence", () => {
    expect(
      resolveMobileRole(["tenant", "owner", "technician", "manager"]),
    ).toBe("manager");
    expect(resolveMobileRole(["owner", "technician"])).toBe("technician");
    expect(resolveMobileRole(["tenant", "owner"])).toBe("owner");
    expect(
      resolveMobileRole(["company_administrator", "accountant"]),
    ).toBeNull();
  });
  it("holds the exact role tab order", () => {
    expect(roleTabs).toEqual({
      manager: ["home", "inbox", "records", "maintenance", "co-worker"],
      owner: ["home", "inbox", "portfolio", "statements", "co-worker"],
      tenant: ["home", "inbox", "payments", "maintenance", "co-worker"],
      technician: ["jobs", "inbox", "co-worker"],
    });
  });
});
