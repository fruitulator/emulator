import './agegate.css';
import { GATE_COPY, type GatePara } from './agegate-copy';

export const AGE_COOKIE = 'age18';
export const AGE_TTL_MS = 24 * 60 * 60 * 1000;
export const AGE_OK_CLASS = 'age-ok';
export const APP_READY_CLASS = 'app-ready';

export function acceptCookie(now: number, secure: boolean): string {
  return `${AGE_COOKIE}=${Math.floor(now)}; Max-Age=${AGE_TTL_MS / 1000}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function isAccepted(cookies: string, now: number): boolean {
  for (const part of cookies.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== AGE_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    if (!/^\d{1,16}$/.test(raw)) continue;
    const at = Number(raw);
    const age = now - at;
    if (age < AGE_TTL_MS && age > -60_000) return true;
  }
  return false;
}

export interface CookieJar {
  cookie: string;
}

export function hasValidAnswer(jar: CookieJar, now = Date.now()): boolean {
  try {
    return isAccepted(jar.cookie, now);
  } catch {
    return false;
  }
}

export function rememberAnswer(jar: CookieJar, now = Date.now(), secure = false): boolean {
  try {
    jar.cookie = acceptCookie(now, secure);
    return isAccepted(jar.cookie, now);
  } catch {
    return false;
  }
}

export function ageGate(enter: () => Promise<unknown>, doc: Document = document): void {
  const go = (): void => {
    doc.documentElement.classList.add(AGE_OK_CLASS);
    enter().then(() => {
      doc.documentElement.classList.add(APP_READY_CLASS);
    }, (err: unknown) => {
      console.error(err);
    });
  };
  if (hasValidAnswer(doc)) {
    go();
    return;
  }

  const gate = doc.createElement('div');
  gate.className = 'agegate nb-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'agegate-title');
  const box = el(doc, 'div', 'agegate-box nb-gate__card');
  box.tabIndex = -1;
  const scroll = el(doc, 'div', 'agegate-scroll');
  const btns = el(doc, 'div', 'agegate-btns nb-gate__actions');
  const yes = el(doc, 'button', 'nb-btn nb-btn--primary agegate-yes', GATE_COPY.over);
  const no = el(doc, 'button', 'nb-btn agegate-no', GATE_COPY.under);
  yes.setAttribute('type', 'button');
  no.setAttribute('type', 'button');
  btns.append(yes, no);
  fill(doc, scroll, GATE_COPY.heading, GATE_COPY.paras);
  box.append(scroll, btns);
  gate.append(box);
  doc.body.appendChild(gate);
  box.focus();

  yes.addEventListener('click', () => {
    rememberAnswer(doc, Date.now(), doc.location?.protocol === 'https:');
    gate.remove();
    go();
  });
  no.addEventListener('click', () => {
    gate.classList.add('agegate-left');
    scroll.replaceChildren();
    fill(doc, scroll, GATE_COPY.leftHeading, GATE_COPY.leftParas);
    btns.remove();
    box.focus();
  });
}

function el(doc: Document, tag: string, cls: string, text?: string): HTMLElement {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fill(doc: Document, into: HTMLElement, heading: string, paras: GatePara[]): void {
  const word = doc.createElement('img');
  word.className = 'agegate-wordmark';
  word.src = '/icons/fruitulator-cherries.svg?v=1';
  word.alt = GATE_COPY.wordmarkAlt;
  const ring = el(doc, 'span', 'nb-gate__mark');
  const mark = doc.createElement('img');
  mark.src = '/icons/18plus.svg';
  mark.width = 72;
  mark.height = 72;
  mark.alt = GATE_COPY.markAlt;
  ring.append(mark);
  const h = el(doc, 'h2', 'agegate-title', heading);
  h.id = 'agegate-title';
  into.append(word, ring, h);
  for (const para of paras) {
    const p = el(doc, 'p', 'agegate-text');
    for (const run of typeof para === 'string' ? [para] : para) {
      if (typeof run === 'string') {
        p.append(run);
      } else if ('strong' in run) {
        const b = doc.createElement('strong');
        b.textContent = run.strong;
        p.append(b);
      } else {
        const a = doc.createElement('a');
        a.href = run.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = run.text;
        p.append(a);
      }
    }
    into.append(p);
  }
}
