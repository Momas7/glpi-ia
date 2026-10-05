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

describe("can: técnico que é apenas o solicitante do chamado de outra equipe", () => {
  const agent = user("AGENT"); // equipe t1
  const lead = user("TEAM_LEAD");
  const mineInOtherTeam = { requesterId: "u1", teamId: "t2", assigneeId: null };

  it("lê e comenta como solicitante comum", () => {
    expect(can(agent, "ticket:read", mineInOtherTeam)).toBe(true);
    expect(can(agent, "comment:create", mineInOtherTeam)).toBe(true);
  });

  it("não lê notas internas, não edita, não fecha nem atribui", () => {
    for (const a of ["comment:read_internal", "ticket:update", "ticket:close"] as Action[]) {
      expect(can(agent, a, mineInOtherTeam), a).toBe(false);
    }
    expect(can(lead, "ticket:assign", mineInOtherTeam)).toBe(false);
  });

  it("mantém os direitos de técnico quando também é da equipe ou o responsável", () => {
    expect(can(agent, "comment:read_internal", { requesterId: "u1", teamId: "t1", assigneeId: null })).toBe(true);
    expect(can(agent, "ticket:update", { requesterId: "u1", teamId: "t2", assigneeId: "u1" })).toBe(true);
  });
});

describe("can: sem recurso", () => {
  it("ações sobre chamado sem recurso são negadas (exceto criar e ADMIN)", () => {
    expect(can(user("AGENT"), "ticket:read")).toBe(false);
    expect(can(user("AGENT"), "ticket:create")).toBe(true);
  });
});

describe("can: ações da gestão (Fase 2.1)", () => {
  const agent = user("AGENT"); // u1, equipe t1
  const lead = user("TEAM_LEAD");
  const admin = user("ADMIN", "a1", []);
  const requester = user("REQUESTER", "r1", []);
  const unassignedT1 = { requesterId: "r1", teamId: "t1", assigneeId: null };

  it("ticket:take: técnico ou líder da equipe, só sem responsável", () => {
    expect(can(agent, "ticket:take", unassignedT1)).toBe(true);
    expect(can(lead, "ticket:take", unassignedT1)).toBe(true);
    expect(can(agent, "ticket:take", { ...unassignedT1, assigneeId: "outro" })).toBe(false);
    expect(can(agent, "ticket:take", { ...unassignedT1, teamId: "t2" })).toBe(false);
    expect(can(requester, "ticket:take", unassignedT1)).toBe(false);
    expect(can(admin, "ticket:take", unassignedT1)).toBe(true);
  });

  it("ticket:reopen e ticket:confirm: só o solicitante, só em RESOLVED", () => {
    for (const a of ["ticket:reopen", "ticket:confirm"] as Action[]) {
      expect(can(requester, a, { ...unassignedT1, status: "RESOLVED" }), a).toBe(true);
      expect(can(requester, a, { ...unassignedT1, status: "CLOSED" }), a).toBe(false);
      expect(can(requester, a, { ...unassignedT1, status: "OPEN" }), a).toBe(false);
      expect(can(agent, a, { ...unassignedT1, status: "RESOLVED" }), `${a} técnico da equipe`).toBe(false);
      expect(can(admin, a, { ...unassignedT1, status: "RESOLVED" }), `${a} admin`).toBe(false);
      expect(can(user("REQUESTER", "outro", []), a, { ...unassignedT1, status: "RESOLVED" }), `${a} outro`).toBe(false);
    }
  });

  it("admin:manage: só ADMIN", () => {
    expect(can(admin, "admin:manage")).toBe(true);
    for (const u of [agent, lead, requester]) expect(can(u, "admin:manage")).toBe(false);
  });
});

describe("can: dashboard:view", () => {
  it("só gestor de equipe e admin", () => {
    expect(can(user("TEAM_LEAD"), "dashboard:view")).toBe(true);
    expect(can(user("ADMIN"), "dashboard:view")).toBe(true);
    expect(can(user("AGENT"), "dashboard:view")).toBe(false);
    expect(can(user("REQUESTER"), "dashboard:view")).toBe(false);
  });
});

describe("can: ai:decide", () => {
  it("segue a regra de editar o chamado: equipe, responsável e admin", () => {
    expect(can(user("ADMIN"), "ai:decide", otherTeamTicket)).toBe(true);
    expect(can(user("AGENT"), "ai:decide", myTeamTicket)).toBe(true);
    expect(can(user("TEAM_LEAD"), "ai:decide", myTeamTicket)).toBe(true);
    expect(can(user("AGENT"), "ai:decide", assignedToMe)).toBe(true);
  });
  it("nega a técnico de outra equipe e ao solicitante, mesmo dono do chamado", () => {
    expect(can(user("AGENT"), "ai:decide", otherTeamTicket)).toBe(false);
    expect(can(user("REQUESTER"), "ai:decide", ownTicket)).toBe(false);
    expect(can(user("AGENT"), "ai:decide")).toBe(false);
  });
});
