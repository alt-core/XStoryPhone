function normalizeQuery(input: string) {
  return input.normalize("NFKC").trim().toLowerCase();
}

function normalizeSearchTerm(input: string) {
  return input.normalize("NFKC").toLowerCase();
}

function searchTermsMatch(terms: readonly string[], normalizedQuery: string) {
  return terms.every((term) => normalizedQuery.includes(normalizeSearchTerm(term)));
}

function searchResponseTermsMatch(search: readonly (readonly string[])[] | undefined, normalizedQuery: string) {
  if (!search?.length) {
    return true;
  }

  return search.some((terms) => searchTermsMatch(terms, normalizedQuery));
}

export {
  normalizeQuery,
  normalizeSearchTerm,
  searchResponseTermsMatch,
  searchTermsMatch
};
