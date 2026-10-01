import type { TournamentView } from '../game/Tournament';

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** トーナメント表 (rounds as columns, races as boxes). */
export function bracketHtml(v: TournamentView, highlight: string | null = null): string {
  const byId = new Map(v.entrants.map((e) => [e.id, e]));
  if (!v.rounds.length) {
    const list = v.entrants.filter((e) => !e.withdrawn);
    return `<div class="tb-reg"><b>エントリー ${list.length}名</b><div class="tb-names">${list.map((e) => `<span class="${e.id === highlight ? 'me' : ''}">${esc(e.horseName)}<small>${esc(e.cpu ? 'CPU' : e.jockey)}</small></span>`).join('')}</div></div>`;
  }
  const cols = v.rounds.map((round) => {
    const races = round.races.map((r) => {
      const current = r.id === v.currentRaceId;
      const rows = r.entrants.map((id) => {
        const e = byId.get(id);
        const res = r.results.find((x) => x.entrantId === id);
        const q = r.qualifiers.includes(id);
        const cls = [q ? 'q' : '', res && !q && r.qualifiers.length ? 'out' : '', id === highlight ? 'me' : '', e?.withdrawn ? 'wd' : ''].join(' ');
        return `<li class="${cls}"><span class="tb-place">${res ? res.place : ''}</span>${esc(e?.horseName ?? '?')}<small>${esc(e?.cpu ? 'CPU' : (e?.jockey ?? ''))}</small></li>`;
      });
      return `<div class="tb-race ${current ? 'current' : ''} ${r.status}"><div class="tb-label">${esc(r.label)}${current ? ' <em>NEXT</em>' : ''}</div><ol>${rows.join('')}</ol></div>`;
    });
    return `<div class="tb-col"><div class="tb-round">${esc(round.label)}</div>${races.join('')}</div>`;
  });
  return `<div class="tb">${cols.join('')}</div>`;
}

/** 表彰式 */
export function awardsHtml(v: TournamentView): string {
  const byId = new Map(v.entrants.map((e) => [e.id, e]));
  return `<div class="aw">${v.awards
    .map((a) => {
      const e = a.entrantId ? byId.get(a.entrantId) : null;
      return `<div class="aw-item ${a.id === 'champion' ? 'champ' : ''}"><div class="aw-title">${esc(a.title)}</div><div class="aw-name">${e ? esc(e.horseName) : '該当なし'}</div><div class="aw-sub">${e ? `${esc(e.cpu ? 'CPU' : e.jockey)}　${esc(a.value)}` : ''}</div><div class="aw-desc">${esc(a.description)}</div></div>`;
    })
    .join('')}</div>`;
}
