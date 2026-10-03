import { describe, expect, it } from "vitest";
import { mask, unmask, unmaskDeep } from "@/modules/ai/masking";

const roundTrip = (input: string) => {
  const { text, map } = mask(input);
  return unmask(text, map);
};

describe("mask: documentos", () => {
  it("mascara CPF válido, formatado ou não", () => {
    expect(mask("CPF 123.456.789-09 ok").text).toBe("CPF [CPF_1] ok");
    expect(mask("cpf 12345678909").text).toBe("cpf [CPF_1]");
  });

  it("não mascara CPF com dígito verificador inválido ou repetido", () => {
    expect(mask("123.456.789-00").text).toBe("123.456.789-00");
    expect(mask("111.111.111-11").text).toBe("111.111.111-11");
  });

  it("mascara CNPJ válido", () => {
    expect(mask("CNPJ 11.222.333/0001-81").text).toBe("CNPJ [CNPJ_1]");
    expect(mask("11.222.333/0001-82").text).toBe("11.222.333/0001-82");
  });

  it("CPF colado em texto e seguido de ponto final", () => {
    expect(mask("cpf123.456.789-09.").text).toBe("cpf[CPF_1].");
  });
});

describe("mask: contato e rede", () => {
  it("mascara e-mails e reutiliza o token do mesmo endereço", () => {
    const { text, map } = mask("de ana@empresa.com para caio@empresa.com; cc ana@empresa.com");
    expect(text).toBe("de [EMAIL_1] para [EMAIL_2]; cc [EMAIL_1]");
    expect(map["[EMAIL_1]"]).toBe("ana@empresa.com");
  });

  it("mascara telefones brasileiros", () => {
    expect(mask("ligue (11) 91234-5678").text).toBe("ligue [TEL_1]");
    expect(mask("fixo 11 3456-7890").text).toBe("fixo [TEL_1]");
    expect(mask("+55 11 91234-5678").text).toBe("[TEL_1]");
  });

  it("mascara IPv4 e IPv6, mas não versão nem horário", () => {
    expect(mask("host 192.168.0.10.").text).toBe("host [IP_1].");
    expect(mask("v6 2001:db8::1 ok").text).toBe("v6 [IP_1] ok");
    expect(mask("versão 1.2.3 às 10:30:15").text).toBe("versão 1.2.3 às 10:30:15");
  });
});

describe("mask: cartão e segredos", () => {
  it("mascara cartão com Luhn válido e ignora o inválido", () => {
    expect(mask("cartão 4111 1111 1111 1111").text).toBe("cartão [CARTAO_1]");
    expect(mask("1234 5678 9012 3456").text).toBe("1234 5678 9012 3456");
  });

  it("mascara senhas e tokens por padrão", () => {
    expect(mask("senha: abc123xyz").text).toBe("senha: [SEGREDO_1]");
    expect(mask("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def").text).toBe("Authorization: Bearer [SEGREDO_1]");
    expect(mask("chave gk_ab12cd34_0123456789abcdef0123456789abcdef").text).toBe("chave [SEGREDO_1]");
  });
});

describe("mask: sem falsos positivos", () => {
  it("números curtos e anos ficam como estão", () => {
    const t = "erro 504 na sala 12 em 2024 2025 2026, chamado 1500";
    expect(mask(t).text).toBe(t);
  });
});

describe("mask/unmask", () => {
  it("ida e volta devolve o texto original", () => {
    const samples = [
      "CPF 123.456.789-09, e-mail ana@empresa.com, tel (11) 91234-5678, ip 10.0.0.1",
      "cartão 4111 1111 1111 1111 e senha: s3gredo!",
      "CNPJ 11.222.333/0001-81 e 2001:db8::1",
      "sem nada sensível",
    ];
    for (const s of samples) expect(roundTrip(s)).toBe(s);
  });

  it("neutraliza token falso no texto, para o unmask não injetar valores trocados", () => {
    const input = "meu CPF é [CPF_1] e o outro é 123.456.789-09";
    const { text, map } = mask(input);
    expect(text).toBe("meu CPF é [CPF 1] e o outro é [CPF_1]");
    expect(unmask(text, map)).toBe("meu CPF é [CPF 1] e o outro é 123.456.789-09");
  });

  it("token inexistente na resposta do modelo fica como está", () => {
    expect(unmask("fale com [EMAIL_9]", {})).toBe("fale com [EMAIL_9]");
  });

  it("unmaskDeep desfaz tokens em strings aninhadas", () => {
    const { map } = mask("ana@empresa.com");
    expect(unmaskDeep({ a: ["oi [EMAIL_1]"], n: 3, b: { c: "[EMAIL_1]" } }, map)).toEqual({
      a: ["oi ana@empresa.com"],
      n: 3,
      b: { c: "ana@empresa.com" },
    });
  });
});
