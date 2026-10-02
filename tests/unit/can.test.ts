import { describe, expect, it } from "vitest";
import { can, type Action } from "@/modules/auth/can";
import type { Role, SessionUser } from "@/modules/auth/session";

const user = (role: Role, id = "u1", teamIds: string[] = ["t1"]): SessionUser => ({
  id,
  name: "N",
  email: "n@x.com",
  role,
  teamIds,
});

const ownTicket = { requesterId: "u1", teamId: null, assigneeId: null };
const othersTicket = { requesterId: "other", teamId: null, assigneeId: null };
const myTeamTicket = { requesterId: "other", teamId: "t1", assigneeId: null };
const otherTeamTicket = { requesterId: "other", teamId: "t2", assigneeId: null };
const assignedToMe = { requesterId: "other", teamId: "t2", assigneeId: "u1" };

describe("can: REQUESTER", () => {
  const u = user("REQUESTER");
  it("cria chamados e lê/comenta/anexa só nos próprios", () => {
    expect(can(u, "ticket:create")).toBe(true);
    for (const a of ["ticket:read", "comment:create", "attachment:add"] as Action[]) {
      expect(can(u, a, ownTicket), a).toBe(true);
      expect(can(u, a, othersTicket), a).toBe(false);
      expect(can(u, a, myTeamTicket), `${a} equipe não conta para solicitante`).toBe(false);
    }
  });
  it("nunca lê nota interna, atualiza, atribui ou fecha", () => {
    for (const a of ["comment:read_internal", "ticket:update", "ticket:assign", "ticket:close"] as Action[]) {
      expect(can(u, a, ownTicket), a).toBe(false);
    }
  });
  it("não administra usuários", () => {
    expect(can(u, "user:invite")).toBe(false);
    expect(can(u, "user:manage")).toBe(false);
  });
});

describe("can: AGENT", () => {
  const u = user("AGENT");
  it("lê, atualiza, comenta, vê notas internas e fecha chamados da equipe", () => {
    for (const a of ["ticket:read", "ticket:update", "ticket:close", "comment:create", "comment:read_internal", "attachment:add"] as Action[]) {
      expect(can(u, a, myTeamTicket), a).toBe(true);
      expect(can(u, a, otherTeamTicket), `${a} outra equipe`).toBe(false);
    }
  });
  it("acessa chamados atribuídos a ele mesmo e os que abriu", () => {
    expect(can(u, "ticket:update", assignedToMe)).toBe(true);
    expect(can(u, "ticket:read", ownTicket)).toBe(true);
  });
  it("não atribui nem administra usuários", () => {
    expect(can(u, "ticket:assign", myTeamTicket)).toBe(false);
    expect(can(u, "user:invite")).toBe(false);
  });
});

describe("can: TEAM_LEAD", () => {
  const u = user("TEAM_LEAD");
  it("atribui dentro da própria equipe e não em outra", () => {
    expect(can(u, "ticket:assign", myTeamTicket)).toBe(true);
    expect(can(u, "ticket:assign", otherTeamTicket)).toBe(false);
  });
  it("tem as permissões de AGENT na equipe", () => {
    expect(can(u, "ticket:update", myTeamTicket)).toBe(true);
    expect(can(u, "comment:read_internal", myTeamTicket)).toBe(true);
  });
  it("não administra usuários", () => {
    expect(can(u, "user:manage")).toBe(false);
  });
});

describe("can: ADMIN", () => {
  const u = user("ADMIN", "a1", []);
  it("pode tudo, em qualquer equipe", () => {
    const actions: Action[] = ["ticket:create", "ticket:read", "ticket:update", "ticket:assign", "ticket:close", "comment:create", "comment:read_internal", "attachment:add", "user:invite", "user:manage"];
    for (const a of actions) expect(can(u, a, otherTeamTicket), a).toBe(true);
  });
});

describe("can: sem recurso", () => {
  it("ações sobre chamado sem recurso são negadas (exceto criar e ADMIN)", () => {
    expect(can(user("AGENT"), "ticket:read")).toBe(false);
    expect(can(user("AGENT"), "ticket:create")).toBe(true);
  });
});
