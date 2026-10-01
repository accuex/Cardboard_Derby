import { gateColors, runningStyleLabel } from '../config/horses';
import { judgeBuildType } from '../sim/buildType';
import { el, formatRaceTime, raceTitle } from '../ui/format';
import { formatPrize, formatYen, type TvDay, type TvRace } from './Programme';
import { formText, recordText, type TvHorse } from './Stable';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const roman: Record<string, string> = { G1: 'GⅠ', G2: 'GⅡ', G3: 'GⅢ', OP: 'OP' };

export interface GuideOdds {
  odds: number[];
  pop: number[];
  marks: string[];
  done: number;
  total: number;
}

const gateNum = (gate: number) => {
  const gc = gateColors[(gate - 1) % gateColors.length];
  return `<span class="tvg-num" style="background:${gc.bg};color:${gc.fg}">${gate}</span>`;
};
const gradeTag = (g: string) => (g ? `<span class="grade grade-${g.toLowerCase()}">${roman[g] ?? g}</span>` : '');

/**
 * The between-races programme screen: today's card on the left, the next race's
 * 出馬表 with live odds on the right, the countdown to post time at the top.
 */
export class TvGuide {
  readonly root = el('div', 'tv-guide');
  private readonly head = el('div', 'tvg-head');
  private readonly body = el('div', 'tvg-body');
  private readonly foot = el('div', 'tvg-foot');
  private readonly clock = el('div', 'tvg-clock');

  constructor() {
    this.root.setAttribute('aria-live', 'polite');
    this.root.append(this.head, this.body, this.foot);
  }

  get visible(): boolean {
    return this.root.classList.contains('show');
  }

  hide(): void {
    this.root.classList.remove('show');
  }

  private header(day: TvDay): void {
    this.head.innerHTML =
      `<div class="tvg-logo">段ボール競馬中継<small>CARDBOARD DERBY LIVE</small></div>` +
      `<div class="tvg-day"><b>第${day.day}日</b>${esc(day.venueName)}<span>天候 ${esc(day.weather)}・芝 ${esc(day.going)}</span></div>`;
    this.head.append(this.clock);
  }

  setCountdown(label: string, seconds: number): void {
    const s = Math.max(0, Math.ceil(seconds));
    this.clock.innerHTML = `<small>${esc(label)}</small><b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b>`;
  }

  setFooter(html: string): void {
    this.foot.innerHTML = html;
  }

  /** Today's races with winners and payouts; `current` is highlighted. */
  private programme(day: TvDay, stable: TvHorse[], current: TvRace | null): HTMLElement {
    const sec = el('section', 'tvg-prog');
    const rows = day.races
      .map((r) => {
        const cls = r === current ? 'next' : r.result ? 'done' : '';
        let right = `<span class="tvg-cond">芝${r.distance}m</span>`;
        if (r.result) {
          const w = stable[r.result.order[0]];
          const gate = r.field!.indexOf(w.id) + 1;
          right = `${gateNum(gate)}<span class="tvg-win">${esc(w.profile.name)}</span><span class="tvg-pay">${formatYen(r.result.payWin)}</span>`;
        } else if (r === current) right += '<span class="tvg-badge">次</span>';
        return `<li class="${cls}${r.grade && r.grade !== 'OP' ? ' main' : ''}"><span class="tvg-time">${r.postTime}</span><span class="tvg-no">${r.no}R</span><span class="tvg-rname">${esc(r.name)}${gradeTag(r.grade)}</span>${right}</li>`;
      })
      .join('');
    sec.innerHTML = `<h3>本日のレース</h3><ol>${rows}</ol>`;
    return sec;
  }

  /** Programme + 出馬表 for the next race. */
  showCard(day: TvDay, stable: TvHorse[], race: TvRace, odds: GuideOdds | null): void {
    this.header(day);
    const card = el('section', 'tvg-card');
    const title = raceTitle(race);
    const ai = odds && odds.done ? this.aiPick(race, stable, odds) : '';
    const rows = race.field!
      .map((id, i) => {
        const h = stable[id];
        const p = h.profile;
        const type = judgeBuildType(p.body);
        const o = odds?.odds[i];
        const pop = odds?.pop[i];
        const mark = odds?.marks[i] ?? '';
        return (
          `<tr class="${pop === 1 ? 'fav' : ''}"><td>${gateNum(i + 1)}</td><td class="tvg-mark m${mark ? '◎○▲△☆'.indexOf(mark) : ''}">${mark}</td>` +
          `<td class="tvg-horse"><i style="background:${esc(p.silkColor)}"></i><b>${esc(p.name)}</b><small>${esc(type.name)}</small></td>` +
          `<td>${esc(p.jockey ?? '')}</td><td>${runningStyleLabel[p.style]}</td><td class="tvg-form">${formText(h)}</td><td>${recordText(h)}</td>` +
          `<td class="tvg-odds">${o ? o.toFixed(1) : '--.-'}</td><td class="tvg-pop">${pop ? `${pop}番人気` : ''}</td></tr>`
        );
      })
      .join('');
    const status = !odds ? 'オッズ集計中…' : odds.done < odds.total ? `オッズ集計中 ${odds.done}/${odds.total}` : '';
    card.innerHTML =
      `<div class="tvg-race"><span class="tvg-rno">${race.no}R</span><div><h2>${esc(title)} ${gradeTag(race.grade)}</h2>` +
      `<div class="tvg-meta">${esc(day.venueName)}　芝${race.distance.toLocaleString()}m　${race.field!.length}頭　${race.postTime}発走　1着賞金 ${formatPrize(race.prize)}</div></div></div>` +
      `<table class="tvg-table"><thead><tr><th>馬番</th><th>印</th><th>馬名</th><th>騎手</th><th>脚質</th><th>近走</th><th>成績</th><th>単勝</th><th>人気</th></tr></thead><tbody>${rows}</tbody></table>` +
      `<div class="tvg-ai">${ai}<span class="tvg-status">${status}</span></div>`;
    this.body.replaceChildren(this.programme(day, stable, race), card);
    this.root.classList.remove('summary');
    this.root.classList.add('show');
  }

  private aiPick(race: TvRace, stable: TvHorse[], odds: GuideOdds): string {
    const best = odds.marks.indexOf('◎');
    const value = odds.marks.indexOf('☆');
    if (best < 0) return '';
    const h = stable[race.field![best]];
    let text = `<b>AI予想</b> ◎ ${best + 1}番 ${esc(h.profile.name)}（試走${odds.done}回の結果より）`;
    if (value >= 0) text += `　穴は☆ ${value + 1}番 ${esc(stable[race.field![value]].profile.name)}`;
    return text;
  }

  /** End of the day: every winner, the biggest payout, the fastest time. */
  showSummary(day: TvDay, stable: TvHorse[], nextVenue: string): void {
    this.header(day);
    const done = day.races.filter((r) => r.result);
    const sec = el('section', 'tvg-summary');
    const rows = done
      .map((r) => {
        const res = r.result!;
        const w = stable[res.order[0]];
        const gate = r.field!.indexOf(w.id) + 1;
        return `<tr><td>${r.no}R</td><td>${esc(r.name)}${gradeTag(r.grade)}</td><td>${gateNum(gate)} ${esc(w.profile.name)}</td><td>${esc(w.profile.jockey ?? '')}</td><td>${res.winnerTime ? formatRaceTime(res.winnerTime) : '--'}</td><td>${res.winnerPop}番人気</td><td class="tvg-pay">${formatYen(res.payWin)}</td></tr>`;
      })
      .join('');
    const top = [...done].sort((a, b) => b.result!.payWin - a.result!.payWin)[0];
    const falls = done.reduce((a, r) => a + r.result!.falls, 0);
    const parts = done.reduce((a, r) => a + r.result!.partsLost, 0);
    const jockeyWins = new Map<string, number>();
    for (const r of done) {
      const j = stable[r.result!.order[0]].profile.jockey ?? '';
      jockeyWins.set(j, (jockeyWins.get(j) ?? 0) + 1);
    }
    const [mvp, mvpWins] = [...jockeyWins].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const highlights = [
      top ? `<div><small>最高配当</small><b>${top.no}R 単勝 ${formatYen(top.result!.payWin)}</b></div>` : '',
      `<div><small>本日の転倒</small><b>${falls}回</b></div>`,
      `<div><small>脱落した部品</small><b>${parts}個</b></div>`,
      mvp ? `<div><small>最多勝騎手</small><b>${esc(mvp)}（${mvpWins}勝）</b></div>` : '',
    ].join('');
    sec.innerHTML =
      `<h2>本日の全レース終了</h2><div class="tvg-hl">${highlights}</div>` +
      `<table class="tvg-table"><thead><tr><th>R</th><th>レース</th><th>勝ち馬</th><th>騎手</th><th>タイム</th><th>人気</th><th>単勝</th></tr></thead><tbody>${rows}</tbody></table>` +
      `<div class="tvg-next">次回 第${day.day + 1}日　${esc(nextVenue)}</div>`;
    this.body.replaceChildren(sec);
    this.root.classList.add('show', 'summary');
  }
}
