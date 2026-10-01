import { el } from './format';

const SCREENS: { href: string; icon: string; title: string; text: string }[] = [
  { href: '/host', icon: '📺', title: '大画面（Host）', text: '会場モニターに映す中継画面。ロビーにスマホ参加用のQRコードが出ます。' },
  { href: '/player', icon: '📱', title: 'スマホで参加（Player）', text: '騎手名→馬体設計→スマホが操作パネルになります。' },
  { href: '/commentary', icon: '🎙', title: '実況（Commentary）', text: '各馬の詳細テレメトリと実況ネタ。実況者専用。' },
  { href: '/admin', icon: '🛠', title: '管理（Admin）', text: '発走・中止・レース名/グレード/距離/コース・参加者・結果管理。' },
  { href: '/play', icon: '⌨️', title: 'このPCで遊ぶ', text: 'キーボードで1頭を操作してオンライン対戦。' },
  { href: '/tv', icon: '📡', title: '競馬中継（AIレース観戦）', text: 'テレビの競馬中継のように、AI馬のレースが1日12レース続けて流れます。出馬表・オッズ・払戻つき。' },
  { href: '/play?offline', icon: '🏇', title: 'オフラインで遊ぶ', text: 'サーバーなしで、このタブだけでCPUとレース。' },
];

/** Landing page at "/". */
export function showMenu(): void {
  document.body.classList.add('menu-mode');
  const root = el('div', 'menu');
  const head = el('div', 'menu-head');
  head.append(el('div', 'bs-title', '段ボール競馬'), el('div', 'menu-sub', 'Cardboard Derby — 画面を選んでください'));
  const grid = el('div', 'menu-grid');
  for (const s of SCREENS) {
    const a = el('a', 'menu-card');
    a.href = s.href;
    a.append(el('div', 'menu-icon', s.icon), el('div', 'menu-title', s.title), el('div', 'menu-text', s.text));
    grid.append(a);
  }
  root.append(head, grid);
  document.getElementById('app')!.append(root);
}
