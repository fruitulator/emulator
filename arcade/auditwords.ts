export type AuditVerdict = 'books' | 'books-in-only' | 'cannot-book' | 'not-measured';

export const AUDIT_WHY = {
  noOutPath: 'no money out path on this board',
  noIn: 'no coin was booked as money in on this board',
  inWrong: 'a coin was booked at a different value from the one the machine states',
  notPriced: "money out is not priced from the machine's own settings",
  neverSeen: 'money out has never been seen to move on this board',
  shares: "shares another board's money code; money out never seen to move on this board",
  changedSince: 'money out has not been seen to move since its code last changed',
  citationGone: "this board's money out code has changed shape and needs auditing again",
  notMeasured: 'money in has not been measured on this board',
  notAudited: "this board's money out has not been audited",
} as const;
