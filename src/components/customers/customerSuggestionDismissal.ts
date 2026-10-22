export function suggestionDismissKey(customerId: string, suggestionType: string) {
  return `lingshu:crm:dismissed:${customerId}:${suggestionType}`;
}

export function isSuggestionDismissed(customerId: string, suggestionType: string) {
  const until = Number(localStorage.getItem(suggestionDismissKey(customerId, suggestionType)) || 0);
  return Date.now() < until;
}
