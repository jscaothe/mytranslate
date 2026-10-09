/** A term as an entry of the team's glossary.yaml, to paste into the shared file. */
export function yamlEntry(t: { ja: string; vi: string; note: string }): string {
  const q = (s: string) => JSON.stringify(s)
  return [`  - ja: ${q(t.ja)}`, `    vi: ${q(t.vi)}`, ...(t.note ? [`    note: ${q(t.note)}`] : [])].join('\n')
}
