import QRCode from 'qrcode';
import { gateColors, horseRoster } from '../config/horses';
import type { TournamentView } from '../game/Tournament';
import type { LobbyInfo } from '../net/protocol';
import { awardsHtml, bracketHtml } from './TournamentBoard';
import { el } from './format';

/** Online lobby: who is riding which gate, the countdown, and a start button. */
export class LobbyOverlay {
  readonly root = el('div', 'lobby');
  private readonly list = el('div', 'lobby-list');
  private readonly countdown = el('div', 'lobby-countdown');
  private readonly status = el('div', 'lobby-status');
  private readonly startBtn = el('button', 'restart', '今すぐ発走');
  private readonly buildBtn = el('button', 'restart secondary', '馬体を設計して参加');
  private readonly qr = el('div', 'lobby-qr');
  private readonly tPanel = el('div', 'lobby-tournament');
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private tKey = '';
  /** Fired once when the awards are first shown (for confetti). */
  onAwards: (() => void) | null = null;
  private awardsShown = false;

  constructor(raceTitle: string, onStart: (() => void) | null, onBuild: (() => void) | null) {
    const card = el('div', 'lobby-card');
    const head = el('div', 'lobby-head');
    this.titleEl = el('div', 'lobby-title', raceTitle);
    this.subEl = el('div', 'lobby-sub', '出走受付中');
    head.append(this.titleEl, this.subEl);
    const buttons = el('div', 'results-buttons');
    if (onStart) {
      this.startBtn.addEventListener('click', onStart);
      buttons.append(this.startBtn);
    }
    if (onBuild) {
      this.buildBtn.addEventListener('click', onBuild);
      buttons.append(this.buildBtn);
    }
    const hint = el('div', 'lobby-hint', 'スマホは右のQRから、PCは別ウィンドウで開くとそれぞれ1頭ずつ操作できます（空き枠はCPU）。');
    const body = el('div', 'lobby-body');
    const left = el('div', 'lobby-main');
    left.append(this.countdown, this.list, this.status, buttons, hint);
    body.append(left, this.qr);
    card.append(head, body, this.tPanel);
    this.root.append(card);
    void this.makeQr();
  }

  /** QR code with a LAN address phones on the same Wi-Fi can open. */
  private async makeQr(): Promise<void> {
    let host = location.host;
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      try {
        const info = (await (await fetch('/api/info')).json()) as { lan: string[] };
        const ip = info.lan.find((a) => a.startsWith('192.168.')) ?? info.lan.find((a) => a.startsWith('10.')) ?? info.lan[0];
        if (ip) host = `${ip}${location.port ? `:${location.port}` : ''}`;
      } catch {
        /* keep localhost */
      }
    }
    const url = `${location.protocol}//${host}/player`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    this.qr.innerHTML = `<div class="lobby-qr-img">${svg}</div><div class="lobby-qr-title">スマホで読み取って参加</div><div class="lobby-qr-url">${url}</div>`;
  }

  update(info: LobbyInfo | null, visible: boolean, myGate: number | null, tournament: TournamentView | null = null, myEntrant: string | null = null): void {
    this.root.classList.toggle('show', visible);
    if (!visible || !info) return;
    const t = info.mode === 'tournament' ? tournament : null;
    this.root.classList.toggle('tmode', !!t);
    // no race lined up yet (registration / finished): don't show the placeholder CPU field
    this.root.classList.toggle('no-field', !!t && !info.raceLabel);
    if (t) {
      const finished = t.status === 'finished';
      this.root.classList.toggle('awards', finished);
      this.titleEl.textContent = finished ? `${t.name} 表彰式` : t.name;
      this.subEl.textContent = finished ? '全レース終了' : t.status === 'registration' ? 'エントリー受付中（QRから参加）' : info.raceLabel ? `次のレース：${info.raceLabel}` : '大会進行中';
      const key = JSON.stringify([t, myEntrant]);
      if (key !== this.tKey) {
        this.tKey = key;
        this.tPanel.innerHTML = finished ? awardsHtml(t) : bracketHtml(t, myEntrant);
      }
      if (finished && !this.awardsShown) {
        this.awardsShown = true;
        this.onAwards?.();
      }
      if (!finished) this.awardsShown = false;
    } else {
      this.root.classList.remove('awards');
      this.tPanel.innerHTML = '';
      this.tKey = '';
    }
    const byGate = new Map(info.players.map((p) => [p.gate, p]));
    this.list.innerHTML = '';
    horseRoster.forEach((cpu, i) => {
      const gate = i + 1;
      const p = byGate.get(gate);
      const gc = gateColors[i % gateColors.length];
      const row = el('div', `lobby-row${p ? ' human' : ''}${gate === myGate ? ' me' : ''}`);
      const num = el('span', 'lobby-num', String(gate));
      num.style.background = gc.bg;
      num.style.color = gc.fg;
      const who = gate === myGate ? 'あなた' : p ? `${p.jockey || 'プレイヤー'}${p.connected ? '' : ' ⚠切断中'}` : 'CPU';
      row.append(num, el('span', 'lobby-name', p ? p.name : cpu.name), el('span', `lobby-who${p && !p.connected ? ' bad' : ''}`, who));
      this.list.append(row);
    });
    this.countdown.textContent =
      info.countdown !== null ? `発走まで ${Math.ceil(info.countdown)} 秒` : t ? (t.status === 'running' ? '管理者の発走合図を待っています' : '') : '参加者を待っています';
    this.status.textContent = `プレイヤー ${info.players.length}人 ・ 観戦 ${info.spectators}人`;
    this.buildBtn.textContent = myGate ? '馬体を作り直す' : '馬体を設計して参加';
    // Only the Admin starts races unless players are allowed to
    this.startBtn.style.display = info.playersCanStart ? '' : 'none';
  }
}
