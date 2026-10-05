import { describe, expect, it } from "vitest";
import { APP_NAME, buildNavItems } from "@/lib/nav";

const user = (role: "REQUESTER" | "AGENT" | "TEAM_LEAD" | "ADMIN") => ({ id: "u", name: "U", email: "u@x.com", role, teamIds: [] });
const labels = (role: Parameters<typeof user>[0]) => buildNavItems(user(role)).map((i) => i.label);

describe("menu lateral", () => {
  it("o nome do sistema é Sistema de Chamados", () => {
    expect(APP_NAME).toBe("Sistema de Chamados");
  });

  it("solicitante vê Chamados e Novo chamado, sem a base de conhecimento", () => {
    expect(labels("REQUESTER")).toEqual(["Chamados", "Novo chamado"]);
  });

  it("técnico também vê a Base de conhecimento", () => {
    expect(labels("AGENT")).toEqual(["Chamados", "Novo chamado", "Base de conhecimento"]);
    expect(buildNavItems(user("AGENT")).at(-1)?.href).toBe("/kb");
  });

  it("gestor de equipe também vê o Dashboard", () => {
    expect(labels("TEAM_LEAD")).toEqual(["Chamados", "Novo chamado", "Base de conhecimento", "Dashboard"]);
    expect(buildNavItems(user("TEAM_LEAD")).at(-1)?.href).toBe("/dashboard");
  });

  it("admin vê Dashboard e Administração, apontando para /admin", () => {
    expect(labels("ADMIN")).toEqual(["Chamados", "Novo chamado", "Base de conhecimento", "Dashboard", "Administração"]);
    expect(buildNavItems(user("ADMIN")).at(-1)?.href).toBe("/admin");
  });
});
