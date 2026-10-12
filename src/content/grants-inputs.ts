import { parseWholeTokenAmount, parseWholeWorkPayments } from './token-payments';

function localSeconds(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error('Choose a valid date and time for each stage.');
  const date = new Date(value),
    epoch = Math.floor(date.getTime() / 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, value.length);
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > 0xffffffff || local !== value)
    throw new Error('Choose a valid date within the supported range.');
  return epoch;
}

export function parseRoundInputs(
  maximum: string,
  applicationsClose: string,
  reviewClose: string,
  awardsClose: string,
  precision: number,
  now: number,
) {
  const cap = parseWholeTokenAmount(maximum, precision);
  const applications = localSeconds(applicationsClose),
    reviews = localSeconds(reviewClose),
    awards = localSeconds(awardsClose);
  if (applications <= now || applications >= reviews || reviews >= awards)
    throw new Error('Applications must close in the future, followed by reviews, then funding.');
  if (awards - now > 31536000) throw new Error('Finish the round within one year.');
  return {
    maximum: cap,
    applicationsClose: applications,
    reviewClose: reviews,
    awardsClose: awards,
  };
}

export function parseGrantTerms(
  milestones: ReadonlyArray<{ amount: string; due: string }>,
  start: string,
  end: string,
  precision: number,
  cap: bigint,
  now: number,
) {
  const amounts = parseWholeWorkPayments(
    milestones.map((row) => row.amount),
    precision,
  );
  if (amounts.total > cap)
    throw new Error('The requested total exceeds this round’s funding limit.');
  const termStart = localSeconds(start),
    termEnd = localSeconds(end);
  if (termEnd <= termStart || termEnd <= now || termEnd - termStart > 31536000)
    throw new Error('Choose a term ending in the future, after its start and within one year.');
  const dues = milestones.map((row) => localSeconds(row.due));
  if (dues.some((due) => due < termStart || due > termEnd))
    throw new Error('Every milestone must be due within the contribution term.');
  return { ...amounts, dues, termStart, termEnd };
}
