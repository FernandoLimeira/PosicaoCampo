// Identificação das frentes de campo e padronização dos rótulos de chuva
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

function standardizeFieldRainLabels(code, fronts, rain) {
  const keys = new Set((Array.isArray(fronts) ? fronts : []).map(row => canonicalFieldFrontKey(row?.[0])));
  const entries = Array.isArray(rain) ? rain : [];
  const team = label => {
    const match = String(label ?? '').trim().match(/^EQ(?:UIPE|UIPAMENTO)?[.\s:-]*0*(\d+)$/i);
    const number = match ? Number(match[1]) : 0;
    return number >= 3 && number <= 12 ? number : null;
  };
  const legacyNrd = String(code).toUpperCase() === 'NRD' && entries.some(row => Array.isArray(row) && (
    (team(row[0]) !== null && !keys.has(String(team(row[0]))) && keys.has(String(team(row[0]) + 10))) ||
    (/^FT[.\s:-]*0*8$/i.test(String(row[0]).trim()) && keys.has('8'))));
  return entries.map(row => {
    if (!Array.isArray(row) || !row.length) return row;
    let number = legacyNrd ? team(row[0]) : null;
    // Decide linha a linha, como no backend (front_identifiers.py).
    if (number !== null && keys.has(String(number)) && !keys.has(String(number + 10))) number = null;
    const key = number === null ? canonicalFieldFrontKey(row[0]) : String(number + 10);
    return [/^\d+[A-Z]*$/.test(key) ? `FT ${fieldFrontNumber(key)}` : row[0], ...row.slice(1)];
  });
}
