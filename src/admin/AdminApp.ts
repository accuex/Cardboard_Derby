import { horseRoster } from '../config/horses';
import { raceConfig } from '../config/race';
import type { SessionEvents } from '../game/Session';
import type { AdminCommand, AdminSettings, AdminState, RaceRecord, TournamentAdminView } from '../net/protocol';
import { NetSession } from '../net/NetSession';
import { el, formatRaceTime } from '../ui/format';
import { SettingsPanel } from '../ui/SettingsPanel';
import { applyDocumentPrefs } from '../ui/prefs';
import { awardsHtml, bracketHtml } from '../ui/TournamentBoard';

const PHASE_LABEL: Record<string, string> = {
  build: 'ロビー（受付中）', intro: 'レース紹介', paddock: '出走馬紹介', gate: 'ゲートイン', running: 'レース中',
  finish: 'ゴール', replay: 'リプレイ', results: '確定',
};
const ROLE_LABEL: Record<string, string> = { player: 'スマホ', play: 'PC', host: '大画面', commentary: '実況', admin: '管理' };
const esc = (t: string) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Race management screen. */
export class AdminApp {
  private readonly session: NetSession;
  private readonly root = el('div', 'ad');
  private readonly status = el('div', 'ad-status');
  private readonly msg = el('div', 'ad-msg');
  private readonly form = el('form', 'ad-form') as HTMLFormElement;
  private readonly players = el('div', 'ad-players');
  private readonly history = el('div', 'ad-history');
  private readonly tour = el('div', 'ad-tour');
  private tourKey = '';
  private state: AdminState | null = null;
  private formDirty = false;
  private historyKey = '';
  private last = performance.now();

  constructor() {
    document.body.classList.add('dash-mode');
    applyDocumentPrefs();
    const settings = new SettingsPanel();
    document.getElementById('app')!.append(settings.button, settings.panel);
    const events: SessionEvents = { onPhase: () => {}, onReplaySegment: () => {}, onSetup: () => {}, onNotice: (t) => this.flash(t) };
    this.session = new NetSession(raceConfig, events, 'admin');
    const s = this.session.rawSocket;
    s.on('admin:state', (st) => this.onState(st));
    s.on('connect', () => this.auth(''));
    this.buildLayout();
    document.getElementById('app')!.append(this.root);
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    // keep the session's clock running (lobby info, notices)
    this.session.update(Math.min(0.1, (now - this.last) / 1000), null);
    this.last = now;
    requestAnimationFrame((t) => this.frame(t));
  }

  private auth(pin: string): void {
    this.session.rawSocket.emit('admin:auth', pin, (ok) => {
      this.root.classList.toggle('locked', !ok);
      if (!ok && pin) this.flash('PINが違います');
    });
  }

  private command(cmd: AdminCommand, confirmText?: string): void {
    if (confirmText && !confirm(confirmText)) return;
    this.session.rawSocket.emit('admin:command', cmd, (r) => this.flash(r.ok ? r.message ?? '実行しました' : `エラー: ${r.message}`));
  }

  private flash(text: string): void {
    this.msg.textContent = text;
    this.msg.classList.add('show');
    clearTimeout((this.msg as unknown as { t: number }).t);
    (this.msg as unknown as { t: number }).t = window.setTimeout(() => this.msg.classList.remove('show'), 3500);
  }

  private buildLayout(): void {
    const head = el('div', 'ad-head');
    head.append(el('div', 'bs-title', 'レース管理'), this.status);

    const lock = el('div', 'ad-lock');
    const pin = el('input', 'bs-name') as HTMLInputElement;
    pin.placeholder = '管理PIN（サーバー起動時に表示）';
    pin.inputMode = 'numeric';
    const go = el('button', 'restart', '認証');
    go.addEventListener('click', () => this.auth(pin.value));
    lock.append(el('div', '', 'このPC以外から管理するにはPINが必要です'), pin, go);

    const controls = el('div', 'ad-controls');
    const btn = (label: string, cls: string, cmd: AdminCommand, confirmText?: string) => {
      const b = el('button', `restart ${cls}`, label);
      b.addEventListener('click', () => this.command(cmd, confirmText));
      controls.append(b);
    };
    btn('発走', '', { type: 'start' });
    btn('演出スキップ', 'secondary', { type: 'skip' });
    btn('次のレースへ（ロビー）', 'secondary', { type: 'toLobby' });
    btn('リスタート', 'secondary', { type: 'restart' }, '今のレースを捨てて、同じ出走馬で最初からやり直しますか？');
    btn('レース中止', 'danger', { type: 'abort' }, 'レースを中止してロビーに戻しますか？');

    this.form.addEventListener('input', () => (this.formDirty = true));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.command({ type: 'settings', settings: this.readForm() });
      this.formDirty = false;
    });

    const section = (title: string, ...children: HTMLElement[]) => {
      const s = el('section', 'ad-section');
      s.append(el('h3', '', title), ...children);
      return s;
    };
    const exportBtn = el('button', 'restart secondary', 'JSONで保存');
    exportBtn.addEventListener('click', () => this.exportHistory());
    const clearBtn = el('button', 'restart danger', '全削除');
    clearBtn.addEventListener('click', () => this.command({ type: 'clearResults' }, '結果履歴をすべて削除しますか？'));
    const histTools = el('div', 'results-buttons');
    histTools.append(exportBtn, clearBtn);

    this.root.append(
      head,
      lock,
      this.msg,
      section('レース進行', controls),
      section('レース設定', this.form),
      section('大会', this.tour),
      section('参加者（フリーモード）', this.players),
      section('結果管理', histTools, this.history),
    );
  }

  private readForm(): Partial<AdminSettings> {
    const f = new FormData(this.form);
    const auto = f.get('auto') === 'on';
    return {
      mode: f.get('mode') === 'tournament' ? 'tournament' : 'free',
      cpuLevel: (['easy', 'normal', 'hard'].includes(String(f.get('cpuLevel'))) ? String(f.get('cpuLevel')) : 'normal') as AdminSettings['cpuLevel'],
      raceName: String(f.get('raceName') ?? ''),
      edition: Number(f.get('edition')),
      grade: String(f.get('grade')) as AdminSettings['grade'],
      weather: String(f.get('weather') ?? ''),
      courseId: String(f.get('courseId')),
      distance: Number(f.get('distance')),
      autoCountdown: auto ? Number(f.get('countdown')) || 15 : null,
      playersCanStart: f.get('playersCanStart') === 'on',
      autoEdition: f.get('autoEdition') === 'on',
    };
  }

  private renderForm(st: AdminState): void {
    if (this.formDirty && this.form.childElementCount) return; // don't clobber typing
    const s = st.settings;
    const course = st.courses.find((c) => c.id === s.courseId)!;
    const opt = (v: string | number, label: string, sel: boolean) => `<option value="${esc(String(v))}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    this.form.innerHTML = `
      <label>モード<select name="mode">${opt('free', 'フリー（誰でも参加・その場でレース）', s.mode === 'free')}${opt('tournament', '大会（登録→予選→準決勝→決勝）', s.mode === 'tournament')}</select></label>
      <label>CPUの強さ<select name="cpuLevel">${opt('easy', 'やさしい', s.cpuLevel === 'easy')}${opt('normal', 'ふつう', s.cpuLevel === 'normal')}${opt('hard', 'つよい', s.cpuLevel === 'hard')}</select></label>
      <label>レース名（フリー時）<input name="raceName" value="${esc(s.raceName)}" maxlength="24"></label>
      <label>回<input name="edition" type="number" min="1" value="${s.edition}"></label>
      <label>グレード<select name="grade">${['G1', 'G2', 'G3', 'OP', ''].map((g) => opt(g, g || 'なし', g === s.grade)).join('')}</select></label>
      <label>天候<input name="weather" value="${esc(s.weather)}" maxlength="8"></label>
      <label>コース<select name="courseId">${st.courses.map((c) => opt(c.id, c.label, c.id === s.courseId)).join('')}</select></label>
      <label>距離<select name="distance">${course.distances.map((d) => opt(d, `${d}m`, d === s.distance)).join('')}</select></label>
      <label class="chk"><input name="auto" type="checkbox"${s.autoCountdown !== null ? ' checked' : ''}> 参加があったら自動発走</label>
      <label>自動発走までの秒数<input name="countdown" type="number" min="5" max="300" value="${s.autoCountdown ?? 15}"></label>
      <label class="chk"><input name="playersCanStart" type="checkbox"${s.playersCanStart ? ' checked' : ''}> プレイヤーの「今すぐ発走」「もう一度」を許可</label>
      <label class="chk"><input name="autoEdition" type="checkbox"${s.autoEdition ? ' checked' : ''}> レースごとに「第N回」を自動で進める</label>
      <div class="ad-form-foot"><button class="restart" type="submit">設定を反映</button><span class="ad-hint">コースを変えると全画面が自動で読み込み直します</span></div>`;
    // distance list follows the course choice
    const courseSel = this.form.querySelector('select[name=courseId]') as HTMLSelectElement;
    courseSel.addEventListener('change', () => {
      const c = st.courses.find((x) => x.id === courseSel.value)!;
      const dist = this.form.querySelector('select[name=distance]') as HTMLSelectElement;
      dist.innerHTML = c.distances.map((d) => opt(d, `${d}m`, false)).join('');
    });
  }

  private onState(st: AdminState): void {
    this.state = st;
    this.root.classList.remove('locked');
    const r = st.roles;
    this.status.innerHTML =
      `<span class="cm-badge">${PHASE_LABEL[st.phase] ?? st.phase}</span>` +
      (st.phase === 'running' || st.phase === 'finish' ? `<span>タイム ${formatRaceTime(st.raceTime)}</span>` : '') +
      (st.countdown !== null ? `<span>自動発走まで ${Math.ceil(st.countdown)}秒</span>` : '') +
      `<span>接続: ${Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${ROLE_LABEL[k]}${n}`).join(' / ') || 'なし'}</span>`;
    this.renderForm(st);
    this.renderPlayers(st);
    this.renderTournament(st.tournament, st.settings.mode === 'tournament');
    this.renderHistory(st.history);
  }

  private renderPlayers(st: AdminState): void {
    const entered = st.players.filter((p) => p.gate !== null).sort((a, b) => a.gate! - b.gate!);
    const rows = horseRoster.map((cpu, i) => {
      const p = entered.find((x) => x.gate === i + 1);
      if (!p) return `<tr><td>${i + 1}</td><td>${esc(cpu.name)}</td><td>CPU</td><td>-</td><td></td></tr>`;
      const gateSel = `<select data-gate="${esc(p.id)}">${horseRoster.map((_, g) => `<option value="${g + 1}"${g + 1 === p.gate ? ' selected' : ''}>${g + 1}番</option>`).join('')}</select>`;
      const conn = !p.connected ? '<span class="bad">切断</span>' : !p.visible ? '<span class="warn">画面オフ</span>' : `接続中（${ROLE_LABEL[p.role] ?? p.role}）`;
      return `<tr><td>${gateSel}</td><td>${esc(p.horse)}</td><td>${esc(p.jockey)}</td><td>${conn}</td><td><button class="restart danger small" data-kick="${esc(p.id)}">出走取消</button></td></tr>`;
    });
    const watchers = st.players.filter((p) => p.gate === null && p.connected).length;
    const html = `<table class="ad-table"><thead><tr><th>枠</th><th>馬名</th><th>騎手</th><th>接続</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table><div class="ad-hint">観戦・その他の接続 ${watchers}。枠を選ぶと入れ替えます（ロビー中のみ）。</div>`;
    if (this.players.innerHTML === html) return;
    if (this.players.contains(document.activeElement)) return; // a select is open
    this.players.innerHTML = html;
    this.players.querySelectorAll<HTMLSelectElement>('select[data-gate]').forEach((sel) =>
      sel.addEventListener('change', () => this.command({ type: "setGate", id: sel.dataset.gate!, gate: Number(sel.value) })),
    );
    this.players.querySelectorAll<HTMLButtonElement>('button[data-kick]').forEach((b) =>
      b.addEventListener('click', () => this.command({ type: "kick", id: b.dataset.kick! }, 'このプレイヤーの出走を取り消しますか？')),
    );
  }

  private renderTournament(t: TournamentAdminView, on: boolean): void {
    const key = JSON.stringify([t, on]);
    if (key === this.tourKey || this.tour.contains(document.activeElement)) return;
    this.tourKey = key;
    const reg = t.status === 'registration';
    const statusLabel = { registration: 'エントリー受付中', running: '大会進行中', finished: '大会終了' }[t.status];
    const active = t.entrants.filter((e) => !e.withdrawn);
    const firstRound = t.rounds[0]?.races ?? [];
    const raceOf = (id: string) => firstRound.findIndex((r) => r.entrants.includes(id)) + 1;
    const rows = t.entrants
      .map((e) => {
        const move = reg && firstRound.length
          ? `<select data-move="${esc(e.id)}">${firstRound.map((r, i) => `<option value="${i + 1}"${raceOf(e.id) === i + 1 ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>`
          : '';
        const conn = e.cpu ? 'CPU' : t.connected[e.id] ? '接続中' : '<span class="warn">未接続（CPU代走）</span>';
        return `<tr class="${e.withdrawn ? 'wd' : ''}"><td>${esc(e.horseName)}</td><td>${esc(e.cpu ? '-' : e.jockey)}</td><td>${esc(e.nickname)}</td><td>${e.withdrawn ? '棄権' : conn}</td><td>${move}</td><td>${e.withdrawn ? '' : `<button class="restart danger small" data-remove="${esc(e.id)}">${reg ? '削除' : '棄権'}</button>`}</td></tr>`;
      })
      .join('');
    this.tour.innerHTML = `
      ${on ? '' : '<div class="ad-hint warn">いまは「フリー」モードです。レース設定で「大会」に切り替えると、エントリー受付とトーナメント進行が有効になります。</div>'}
      <div class="ad-tour-head"><span class="cm-badge">${statusLabel}</span> エントリー ${active.length}名${t.currentRaceId ? `　次のレース：${esc(t.rounds.flatMap((r) => r.races).find((r) => r.id === t.currentRaceId)?.label ?? '')}` : ''}</div>
      <div class="ad-form ad-tform">
        <label>大会名<input data-t="name" value="${esc(t.config.name)}" maxlength="24"></label>
        <label>予選の勝ち上がり（各組）<input data-t="q" type="number" min="1" max="5" value="${t.config.heatQualifiers}"${reg ? '' : ' disabled'}></label>
        <label class="chk"><input data-t="grade" type="checkbox"${t.config.autoGrade ? ' checked' : ''}> ラウンドでグレード昇格（予選OP→準決勝G2→決勝G1）</label>
        <div class="ad-form-foot"><button class="restart secondary" data-act="tconfig">大会設定を反映</button></div>
      </div>
      <div class="ad-controls">
        ${reg ? `<button class="restart secondary" data-act="tadd">CPU参加者を追加</button><input data-t="count" type="number" min="1" max="60" value="5" class="ad-count">
        <button class="restart secondary" data-act="tdraw">組分け（シャッフル）</button>
        <button class="restart" data-act="tstart">大会開始</button>` : ''}
        <button class="restart danger" data-act="treset">大会をリセット（エントリー保持）</button>
        <button class="restart danger" data-act="tclear">エントリーごと全消去</button>
        <button class="restart secondary" data-act="texport">大会データをJSON保存</button>
      </div>
      ${t.status === 'finished' ? `<h4>特別賞</h4>${awardsHtml(t)}` : ''}
      <h4>トーナメント表</h4>${bracketHtml(t)}
      <h4>エントリー一覧</h4>
      <table class="ad-table"><thead><tr><th>馬名</th><th>騎手</th><th>異名</th><th>状態</th><th>組</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">まだエントリーがありません（スマホのQRから登録）</td></tr>'}</tbody></table>`;
    const val = (k: string) => (this.tour.querySelector(`[data-t="${k}"]`) as HTMLInputElement | null);
    this.tour.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act!;
        if (act === 'tconfig') this.command({ type: 'tconfig', name: val('name')!.value, heatQualifiers: Number(val('q')!.value), autoGrade: val('grade')!.checked });
        else if (act === 'tadd') this.command({ type: 'tadd', count: Number(val('count')!.value) || 1 });
        else if (act === 'tdraw') this.command({ type: 'tdraw' });
        else if (act === 'tstart') this.command({ type: 'tstart' }, `エントリー${active.length}名で大会を開始しますか？（開始後は馬体変更・新規エントリー不可）`);
        else if (act === 'treset') this.command({ type: 'treset', keepEntrants: true }, '大会の進行と結果をリセットしますか？（エントリーは残ります）');
        else if (act === 'tclear') this.command({ type: 'treset', keepEntrants: false }, 'エントリーも含めて大会を全消去しますか？');
        else if (act === 'texport') this.download(t, 'tournament');
      }),
    );
    this.tour.querySelectorAll<HTMLSelectElement>('select[data-move]').forEach((sel) =>
      sel.addEventListener('change', () => this.command({ type: 'tmove', entrantId: sel.dataset.move!, race: Number(sel.value) })),
    );
    this.tour.querySelectorAll<HTMLButtonElement>('button[data-remove]').forEach((b) =>
      b.addEventListener('click', () => this.command({ type: 'tremove', entrantId: b.dataset.remove! }, reg ? 'このエントリーを削除しますか？' : 'この参加者を棄権にしますか？')),
    );
  }

  private download(data: unknown, name: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `cardboard-derby-${name}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 通算記録: best single-race numbers over the whole history. */
  private recordsHtml(list: RaceRecord[]): string {
    type Row = RaceRecord['rows'][number];
    const all = list.flatMap((r) => r.rows.filter((x) => x.stats).map((x) => ({ r, x })));
    if (!all.length) return '';
    const kinds: [string, (x: Row) => number, (v: number) => string][] = [
      ['最高速度', (x) => x.stats!.topSpeed, (v) => `${Math.round(v * 3.6)}km/h`],
      ['最大衝撃', (x) => x.stats!.maxImpact, (v) => `${v.toFixed(1)}m/s`],
      ['1レース最多転倒', (x) => x.stats!.falls, (v) => `${v}回`],
      ['1レース最多修理', (x) => x.stats!.repairs, (v) => `${v}回`],
      ['踏ん張り最多', (x) => x.stats!.braces, (v) => `${v}回`],
      ['最大逆転', (x) => x.stats!.comeback, (v) => `${v}人抜き`],
      ['部品脱落最多', (x) => x.stats!.partsLost, (v) => `${v}個`],
      ['最大構造疲労', (x) => x.stats!.maxFatigue, (v) => `${Math.round(v * 100)}%`],
    ];
    const rows = kinds.map(([label, f, fmt]) => {
      const best = all.reduce((a, b) => (f(b.x) > f(a.x) ? b : a));
      const v = f(best.x);
      return `<tr><td>${label}</td><td>${v > 0 ? fmt(v) : '-'}</td><td>${v > 0 ? `${esc(best.x.name)}（${best.x.jockey ? esc(best.x.jockey) : 'CPU'}）` : ''}</td><td>${v > 0 ? esc(best.r.title) : ''}</td></tr>`;
    });
    return `<h4>通算記録（全${list.length}レース）</h4><table class="ad-table"><thead><tr><th>記録</th><th>値</th><th>保持馬</th><th>レース</th></tr></thead><tbody>${rows.join('')}</tbody></table><h4>レース履歴</h4>`;
  }

  private renderHistory(list: RaceRecord[]): void {
    const key = list.map((r) => r.id).join(',');
    if (key === this.historyKey) return;
    this.historyKey = key;
    if (!list.length) {
      this.history.innerHTML = '<div class="ad-hint">まだ記録がありません（レースが確定すると自動で保存されます）</div>';
      return;
    }
    this.history.innerHTML = this.recordsHtml(list) + list
      .map((r) => {
        const date = new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const rows = r.rows
          .map((x) => `<tr><td>${x.rank ?? '-'}</td><td>${x.gate}</td><td>${esc(x.name)}</td><td>${x.jockey ? esc(x.jockey) : 'CPU'}</td><td>${esc(x.nickname)}</td><td>${x.time != null ? formatRaceTime(x.time) : '--'}</td><td>${x.falls}</td><td>${x.repairs}</td></tr>`)
          .join('');
        return `<details class="ad-record"><summary>${r.tournament ? '<span class="cm-tag brace">大会</span> ' : ''}<b>${esc(r.title)} ${r.grade}</b>　${esc(r.course)} ${r.distance}m　${date}　1着 ${esc(r.rows.find((x) => x.rank === 1)?.name ?? '-')}
          <button class="restart danger small" data-del="${r.id}">削除</button></summary>
          <table class="ad-table"><thead><tr><th>着</th><th>番</th><th>馬名</th><th>騎手</th><th>異名</th><th>タイム</th><th>転倒</th><th>修理</th></tr></thead><tbody>${rows}</tbody></table></details>`;
      })
      .join('');
    this.history.querySelectorAll<HTMLButtonElement>('button[data-del]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        this.command({ type: 'deleteResult', id: b.dataset.del! }, 'この結果を削除しますか？');
      }),
    );
  }

  private exportHistory(): void {
    this.download(this.state?.history ?? [], 'results');
  }
}
