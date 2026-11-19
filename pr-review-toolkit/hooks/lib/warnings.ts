// Collection warnings, shared by prepare (which records them on the run) and the
// board (which derives the total-failure ones from the run's flags and drops a
// repeat by exact match). The two total-failure sentences are the pre-3.0
// review-pr workflow's own (reviewWarnings), word for word.
export const THREADS_FAILED = 'Existing review threads could not be collected, so overlap classification and verdicts on your earlier threads are unavailable, and recommended findings may duplicate existing comments.'
export const THREADS_PARTIAL = 'Review threads may be incomplete.'
export const REVIEWS_FAILED = 'Your submitted reviews could not be read, so asks made only in a review summary are not checked.'
export const REVIEWS_PARTIAL = 'Your earlier reviews could not be read completely.'
