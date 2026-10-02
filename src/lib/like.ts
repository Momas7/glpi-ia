/** O Prisma não escapa os curingas do LIKE em `contains`: escapamos \, % e _ para valerem como texto. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
