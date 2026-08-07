//! Allocation-free weighted selection from a caller-supplied stream of raw `u64` words.

/// Maximum number of clips in one weighted action.
pub const MAX_WEIGHTED_CLIPS_V2: usize = 32;

/// Errors produced while validating weights or consuming a random word.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WeightedRandomErrorV2 {
    /// Weighted playback requires at least two clips.
    TooFewClips,
    /// The contract caps one action at [`MAX_WEIGHTED_CLIPS_V2`] clips.
    TooManyClips,
    /// Every clip weight must be a positive `u32`.
    ZeroWeight,
    /// The checked total did not fit in `u64`.
    TotalWeightOverflow,
    /// Every supplied word fell in the rejection prefix.
    RandomSourceExhausted,
    /// More than `u32::MAX` words were consumed for one selection.
    RandomWordLimitExceeded,
}

/// Caller-owned source of exact raw random words.
pub trait RandomWordSourceV2 {
    /// Returns the next uniformly distributed raw `u64`, or `None` when the source is exhausted.
    fn next_u64(&mut self) -> Option<u64>;
}

/// Auditable result of one weighted selection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WeightedSelectionV2 {
    /// Zero-based index in the original weight slice.
    pub selected_index: u32,
    /// Sum of all positive weights.
    pub total_weight: u64,
    /// `2^64 mod total_weight`; words below this prefix are rejected.
    pub rejection_threshold: u64,
    /// Accepted raw random word.
    pub accepted_word: u64,
    /// `accepted_word mod total_weight`.
    pub ticket: u64,
    /// Number of raw words consumed, including rejected words.
    pub consumed_words: u32,
}

/// Selects one array position using positive integer weights and unbiased rejection sampling.
///
/// The accepted sample space is `[threshold, 2^64)`, where
/// `threshold = 2^64 mod total_weight`. Its size is an exact multiple of
/// `total_weight`. The accepted word is mapped to a ticket with modulo, then to
/// the first half-open cumulative interval containing that ticket.
///
/// # Errors
///
/// Returns [`WeightedRandomErrorV2`] for an invalid weight table, an exhausted
/// source, or a pathological word-consumption overflow.
pub fn select_weighted_v2(
    weights: &[u32],
    source: &mut impl RandomWordSourceV2,
) -> Result<WeightedSelectionV2, WeightedRandomErrorV2> {
    if weights.len() < 2 {
        return Err(WeightedRandomErrorV2::TooFewClips);
    }
    if weights.len() > MAX_WEIGHTED_CLIPS_V2 {
        return Err(WeightedRandomErrorV2::TooManyClips);
    }

    let mut total_weight = 0_u64;
    for &weight in weights {
        if weight == 0 {
            return Err(WeightedRandomErrorV2::ZeroWeight);
        }
        total_weight = total_weight
            .checked_add(u64::from(weight))
            .ok_or(WeightedRandomErrorV2::TotalWeightOverflow)?;
    }

    // `wrapping_neg()` represents 2^64 - total_weight in the u64 ring.
    let rejection_threshold = total_weight.wrapping_neg() % total_weight;
    let mut consumed_words = 0_u32;
    loop {
        let word = source
            .next_u64()
            .ok_or(WeightedRandomErrorV2::RandomSourceExhausted)?;
        consumed_words = consumed_words
            .checked_add(1)
            .ok_or(WeightedRandomErrorV2::RandomWordLimitExceeded)?;
        if word < rejection_threshold {
            continue;
        }

        let ticket = word % total_weight;
        let mut upper_exclusive = 0_u64;
        for (index, &weight) in weights.iter().enumerate() {
            upper_exclusive += u64::from(weight);
            if ticket < upper_exclusive {
                return Ok(WeightedSelectionV2 {
                    selected_index: u32::try_from(index)
                        .map_err(|_| WeightedRandomErrorV2::TooManyClips)?,
                    total_weight,
                    rejection_threshold,
                    accepted_word: word,
                    ticket,
                    consumed_words,
                });
            }
        }
        unreachable!("validated cumulative weights must contain the modulo ticket");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Words<'a> {
        words: &'a [u64],
        position: usize,
    }

    impl RandomWordSourceV2 for Words<'_> {
        fn next_u64(&mut self) -> Option<u64> {
            let word = self.words.get(self.position).copied();
            self.position += usize::from(word.is_some());
            word
        }
    }

    #[test]
    fn rejects_remainder_prefix_and_uses_half_open_weight_ranges() {
        let mut source = Words {
            words: &[0, 2],
            position: 0,
        };
        let result = select_weighted_v2(&[2, 1], &mut source).unwrap();
        assert_eq!(
            result,
            WeightedSelectionV2 {
                selected_index: 1,
                total_weight: 3,
                rejection_threshold: 1,
                accepted_word: 2,
                ticket: 2,
                consumed_words: 2,
            }
        );
    }

    #[test]
    fn power_of_two_total_accepts_full_word_space() {
        let mut source = Words {
            words: &[u64::MAX],
            position: 0,
        };
        let result = select_weighted_v2(&[1, 1, 1, 1], &mut source).unwrap();
        assert_eq!(result.rejection_threshold, 0);
        assert_eq!(result.ticket, 3);
        assert_eq!(result.selected_index, 3);
    }

    #[test]
    fn u32_weight_boundary_is_exact() {
        let mut source = Words {
            words: &[u64::from(u32::MAX)],
            position: 0,
        };
        let result = select_weighted_v2(&[u32::MAX, 1], &mut source).unwrap();
        assert_eq!(result.total_weight, 1_u64 << 32);
        assert_eq!(result.selected_index, 1);
    }

    #[test]
    fn accepted_space_is_divisible_for_representative_totals() {
        for total in [2_u64, 3, 5, 6, 7, 10, 1_u64 << 32] {
            let threshold = total.wrapping_neg() % total;
            let accepted = (1_u128 << 64) - u128::from(threshold);
            assert_eq!(accepted % u128::from(total), 0);
        }
    }

    #[test]
    fn invalid_tables_do_not_consume_random_words() {
        let mut source = Words {
            words: &[7],
            position: 0,
        };
        assert_eq!(
            select_weighted_v2(&[1], &mut source),
            Err(WeightedRandomErrorV2::TooFewClips)
        );
        assert_eq!(source.position, 0);
        assert_eq!(
            select_weighted_v2(&[1, 0], &mut source),
            Err(WeightedRandomErrorV2::ZeroWeight)
        );
        assert_eq!(source.position, 0);
        let too_many = [1_u32; MAX_WEIGHTED_CLIPS_V2 + 1];
        assert_eq!(
            select_weighted_v2(&too_many, &mut source),
            Err(WeightedRandomErrorV2::TooManyClips)
        );
        assert_eq!(source.position, 0);
    }

    #[test]
    fn exhaustion_after_rejection_is_explicit() {
        let mut source = Words {
            words: &[0],
            position: 0,
        };
        assert_eq!(
            select_weighted_v2(&[2, 1], &mut source),
            Err(WeightedRandomErrorV2::RandomSourceExhausted)
        );
    }
}
