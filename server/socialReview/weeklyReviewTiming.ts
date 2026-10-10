/** Matches the existing review worker's UTC reporting window; this is not a user's timezone guess. */
export function weeklyReviewWindowBounds(week:{weekStart:string;weekEnd:string}):{startsAt:string;endsAt:string} {
 const parse=(day:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('weekly_review_window_invalid');
  const date=new Date(`${day}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw Error('weekly_review_window_invalid');
  return date;
 };
 const startsAt=parse(week.weekStart),end=parse(week.weekEnd);
 if(end.getTime()<startsAt.getTime())throw Error('weekly_review_window_invalid');
 end.setUTCDate(end.getUTCDate()+1);
 return {startsAt:startsAt.toISOString(),endsAt:end.toISOString()};
}
