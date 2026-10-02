import Markdown from "react-markdown";

const ALLOWED = ["p", "strong", "em", "code", "ul", "ol", "li", "br"];

/**
 * Renderiza texto de usuário. Só Markdown restrito (negrito, itálico, código inline, listas, quebras):
 * HTML bruto aparece como texto literal e links/imagens não são gerados.
 */
export function SafeText({ value, className }: { value: string; className?: string }) {
  return (
    <div className={className}>
      <Markdown allowedElements={ALLOWED} unwrapDisallowed>
        {value}
      </Markdown>
    </div>
  );
}
