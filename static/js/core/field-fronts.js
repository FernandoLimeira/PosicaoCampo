// Identificação das frentes de campo
// (mesmas regras do backend em front_identifiers.py).
function canonicalFieldFrontKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase()
    .replace(/^(?:(?:EQ(?:UIPE|UIPAMENTO)?|FRENTE|FRT|FT|F|CTT|CCT|PPT|NRD|RBR|PST)(?=[.\s:#-]|\d|$)[.\s:#-]*)+/, '')
    .replace(/\s*[-–—|]\s*(?:SETOR|FAZENDA)\b.*$/, '')
    .replace(/\s+/g, '').replace(/\d+/g, digits => String(Number(digits)));
}

function fieldFrontNumber(value) {
  const key = canonicalFieldFrontKey(value);
  const match = key.match(/^(\d+)([A-Z]*)$/);
  return match ? match[1].padStart(2, '0') + match[2] : String(value ?? '').trim();
}
