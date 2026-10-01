import type { CourseConfig } from '../config/course';
import type { RaceConfig } from '../config/race';
import { el } from './format';

/** Pre-race title card: deliberately over-the-top, like a G1 broadcast. */
export class TitleOverlay {
  readonly root = el('div', 'title-overlay');

  constructor(race: RaceConfig, course: CourseConfig, runners: number) {
    const tagline = el('div', 'title-tagline');
    tagline.innerHTML = race.tagline.split('。').filter(Boolean).map((t) => `<span>${t}。</span>`).join('');

    const plate = el('div', 'title-plate');
    const edition = el('div', 'title-edition', [race.raceNo ? `${race.raceNo}R` : '', race.edition > 0 ? `第${race.edition}回` : ''].filter(Boolean).join('　'));
    const name = el('div', 'title-name', race.name);
    name.dataset.text = race.name;
    plate.append(edition, name);
    if (race.grade) {
      const roman: Record<string, string> = { G1: 'GⅠ', G2: 'GⅡ', G3: 'GⅢ', OP: 'OP' };
      const grade = el('div', 'title-grade');
      const stars = race.grade === 'G1' ? '★★★' : race.grade === 'G2' ? '★★' : '★';
      grade.append(el('span', 'star', stars), el('span', 'g', roman[race.grade] ?? race.grade), el('span', 'star', stars));
      plate.append(grade);
      this.root.classList.add(`grade-${race.grade.toLowerCase()}`);
    }

    const info = el('div', 'title-info');
    const items = [
      course.venueName,
      `${course.surface} ${race.distance.toLocaleString()}m`,
      `天候 ${race.weather}`,
      `出走 ${runners}頭`,
    ];
    items.forEach((t, i) => {
      if (i) info.append(el('span', 'sep', '／'));
      info.append(el('span', 'item', t));
    });

    const sparkles = el('div', 'sparkles');
    for (let i = 0; i < 60; i++) {
      const s = el('i', i % 3 === 0 ? 'confetti' : 'spark');
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDelay = `${Math.random() * 3}s`;
      s.style.animationDuration = `${2 + Math.random() * 3}s`;
      if (i % 3 === 0) s.style.background = `hsl(${Math.random() * 360}, 90%, 60%)`;
      sparkles.append(s);
    }

    this.root.append(sparkles, tagline, plate, info);
  }

  show(): void {
    this.root.classList.remove('hide');
    // restart CSS animations
    this.root.classList.remove('play');
    void this.root.offsetWidth;
    this.root.classList.add('play');
  }

  hide(): void {
    this.root.classList.add('hide');
  }
}
