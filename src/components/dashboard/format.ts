const decimal1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR");
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const formatAverage = (v: number | null) => (v === null ? "—" : decimal1.format(v));
export const formatPercent = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
export const formatInt = (v: number) => integer.format(v);
export const formatUsd = (v: number) => usd.format(v);
// Eixo do gráfico de custo: custos de IA costumam ser frações de centavo, que "0.00" esconderia.
const usdTick = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 2 });
export const formatUsdTick = (v: number) => usdTick.format(v);
