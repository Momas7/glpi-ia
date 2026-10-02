-- Nome de categoria único por nível, sem diferenciar maiúsculas, inclusive na raiz (parentId nulo).
-- O @@unique([name, parentId]) do Prisma não cobre a raiz: no Postgres, NULL não colide com NULL.
CREATE UNIQUE INDEX "Category_lower_name_parentId_key" ON "Category" (lower("name"), "parentId") NULLS NOT DISTINCT;
