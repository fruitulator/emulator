import type { NamedCoin } from '../src/machine/machine';
import { str } from './i18n';

export type CoinAnswers = Record<string, NamedCoin>;

export const COIN_CHOICES: readonly { label: string; coin: NamedCoin }[] = [
  { label: str('coinask.2p'), coin: 2 },
  { label: str('coinask.5p'), coin: 5 },
  { label: str('coinask.10p'), coin: 10 },
  { label: str('coinask.20p'), coin: 20 },
  { label: str('coinask.50p'), coin: 50 },
  { label: '£1', coin: 100 },
  { label: '£2', coin: 200 },
  { label: str('coinask.token'), coin: 'token' },
];

export const COIN_QUESTION = str('coinask.what_coin_goes_in_this');
export const COIN_QUESTION_HINT = str('coinask.asked_once_for_this_game');

export function coinAnswerLabel(coin: NamedCoin): string {
  return COIN_CHOICES.find((c) => c.coin === coin)?.label
    ?? (typeof coin === 'number' ? `${coin}p` : str('coinask.token'));
}

function validCoin(v: unknown): v is NamedCoin {
  return COIN_CHOICES.some((c) => c.coin === v);
}

export function readCoinAnswers(raw: unknown): CoinAnswers {
  const out: CoinAnswers = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && validCoin(v)) out[k] = v;
  }
  return out;
}

export function mustAsk(line: number, unnamed: readonly number[] | undefined, answers: CoinAnswers): boolean {
  if (line < 0 || !unnamed?.includes(line)) return false;
  return !validCoin(answers[String(line)]);
}

export function withAnswer(answers: CoinAnswers, line: number, coin: NamedCoin): CoinAnswers {
  return { ...answers, [String(line)]: coin };
}

export function answersSummary(answers: CoinAnswers): string {
  return Object.keys(answers)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => coinAnswerLabel(answers[String(k)]))
    .join(', ');
}
