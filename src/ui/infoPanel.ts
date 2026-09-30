/** 建筑点击信息面板 */
import type { BuildingProps } from '../data/loader';

const KIND_NAMES: Record<string, string> = {
  teaching: '教学楼',
  dormitory: '宿舍',
  canteen: '食堂/餐饮',
  library: '图书馆',
  gym: '体育场馆',
  factory: '厂房/实训',
  lab: '实验楼',
  hall: '会堂',
  office: '办公楼',
  service: '服务用房',
  other: '建筑',
};

export class InfoPanel {
  private el: HTMLElement;
  private nameEl: HTMLElement;
  private rowsEl: HTMLElement;
  private descEl: HTMLElement;
  onFly?: (props: BuildingProps) => void;

  constructor() {
    this.el = document.getElementById('info-panel')!;
    this.nameEl = document.getElementById('info-name')!;
    this.rowsEl = document.getElementById('info-rows')!;
    this.descEl = document.getElementById('info-desc')!;
    document.getElementById('info-close')!.addEventListener('click', () => this.hide());
    document.getElementById('info-fly')!.addEventListener('click', () => {
      if (this.current) this.onFly?.(this.current);
    });
  }

  private current: BuildingProps | null = null;

  show(p: BuildingProps): void {
    this.current = p;
    this.nameEl.textContent = p.name || '未命名建筑';
    const kind = KIND_NAMES[p.kind] ?? '建筑';
    const rows: [string, string][] = [
      ['类型', kind],
      ['楼层数', `${p.levels} 层`],
      ['高度', `${p.height_m} m`],
    ];
    this.rowsEl.innerHTML = rows
      .map(([k, v]) => `<div class="info-row"><span>${k}</span><b>${v}</b></div>`)
      .join('');
    this.descEl.textContent = p.desc || '';
    this.descEl.style.display = p.desc ? 'block' : 'none';
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.current = null;
    this.el.classList.add('hidden');
  }
}
