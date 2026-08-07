#![no_std]
#![forbid(unsafe_code)]
//! Allocation-free Snapshot execution tables and deterministic point-read planning.

pub mod weighted_random_v2;

use yimi_fw_contract::{
    ActionSlot, ClipSlot, MonotonicUs, PhysicalCode, PhysicalCodeEvent, PlayPolicy,
};

/// One entry in a numerically sorted physical OID index.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OidIndexEntry {
    /// Physical OID emitted by the frozen head adapter.
    pub physical_code: PhysicalCode,
    /// Dense action slot compiled from Snapshot action-array order.
    pub action_slot: ActionSlot,
}

/// OID index construction errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IndexError {
    /// Physical codes were duplicated or not strictly increasing.
    NotStrictlySorted,
}

/// Borrowed, allocation-free OID index.
#[derive(Clone, Copy, Debug)]
pub struct OidIndex<'a> {
    entries: &'a [OidIndexEntry],
}

impl<'a> OidIndex<'a> {
    /// Validates strict numeric ordering and creates an index view.
    ///
    /// # Errors
    ///
    /// Returns [`IndexError::NotStrictlySorted`] for duplicate or descending codes.
    pub fn new(entries: &'a [OidIndexEntry]) -> Result<Self, IndexError> {
        if entries
            .windows(2)
            .any(|pair| pair[0].physical_code >= pair[1].physical_code)
        {
            return Err(IndexError::NotStrictlySorted);
        }
        Ok(Self { entries })
    }

    /// Resolves a physical code using binary search.
    #[must_use]
    pub fn resolve(&self, code: PhysicalCode) -> Option<ActionSlot> {
        self.entries
            .binary_search_by_key(&code, |entry| entry.physical_code)
            .ok()
            .map(|index| self.entries[index].action_slot)
    }

    /// Returns the validated entries.
    #[must_use]
    pub const fn entries(&self) -> &'a [OidIndexEntry] {
        self.entries
    }
}

/// One compact action descriptor. Clip references live in one flat table.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionDescriptor {
    /// Playback policy copied from Snapshot.
    pub play_policy: PlayPolicy,
    /// Per-action accepted-play cooldown in microseconds.
    pub cooldown_us: u64,
    /// First index into the flat action-to-clip table.
    pub first_clip: u32,
    /// Number of ordered clip slots owned by the action.
    pub clip_count: u32,
}

/// Compact execution-model validation errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutionModelError {
    /// Action or clip catalog is empty.
    EmptyTable,
    /// A table length does not fit the frozen u32 slot representation.
    TableTooLarge,
    /// The OID index is not strictly sorted.
    OidIndexNotStrictlySorted,
    /// An OID references an action outside the action table.
    ActionSlotOutOfRange,
    /// More than one physical code references the same action slot.
    DuplicateActionSlot,
    /// An action is not reachable from the OID index.
    UnreferencedAction,
    /// Action clip ranges are not contiguous and complete.
    ClipRangeNotContiguous,
    /// A clip slot is outside the clip catalog.
    ClipSlotOutOfRange,
    /// One action references the same clip more than once.
    DuplicateClipInAction,
    /// A clip catalog entry is unused by every action.
    UnreferencedClip,
    /// The playback policy has an invalid clip count.
    PolicyClipCountMismatch,
}

/// Borrowed compact tables produced by a validated Snapshot parser.
#[derive(Clone, Copy, Debug)]
pub struct ExecutionModel<'a> {
    oid_index: OidIndex<'a>,
    actions: &'a [ActionDescriptor],
    action_clips: &'a [ClipSlot],
    clip_count: u32,
}

impl<'a> ExecutionModel<'a> {
    /// Validates and borrows target-neutral execution tables.
    ///
    /// # Errors
    ///
    /// Returns [`ExecutionModelError`] when table closure, slot bounds, ordering,
    /// policy arity or reachability differs from the v1 contract.
    pub fn new(
        oid_entries: &'a [OidIndexEntry],
        actions: &'a [ActionDescriptor],
        action_clips: &'a [ClipSlot],
        clip_count: u32,
    ) -> Result<Self, ExecutionModelError> {
        if actions.is_empty() || clip_count == 0 {
            return Err(ExecutionModelError::EmptyTable);
        }
        let action_count =
            u32::try_from(actions.len()).map_err(|_| ExecutionModelError::TableTooLarge)?;
        let flat_clip_count =
            u32::try_from(action_clips.len()).map_err(|_| ExecutionModelError::TableTooLarge)?;
        let oid_index = OidIndex::new(oid_entries)
            .map_err(|_| ExecutionModelError::OidIndexNotStrictlySorted)?;

        for (position, entry) in oid_entries.iter().enumerate() {
            if entry.action_slot.0 >= action_count {
                return Err(ExecutionModelError::ActionSlotOutOfRange);
            }
            if oid_entries[..position]
                .iter()
                .any(|previous| previous.action_slot == entry.action_slot)
            {
                return Err(ExecutionModelError::DuplicateActionSlot);
            }
        }
        for slot in 0..action_count {
            if !oid_entries.iter().any(|entry| entry.action_slot.0 == slot) {
                return Err(ExecutionModelError::UnreferencedAction);
            }
        }

        let mut expected_first = 0_u32;
        for action in actions {
            if action.first_clip != expected_first
                || action.clip_count == 0
                || action.first_clip.saturating_add(action.clip_count) > flat_clip_count
            {
                return Err(ExecutionModelError::ClipRangeNotContiguous);
            }
            if (matches!(action.play_policy, PlayPolicy::Replace) && action.clip_count != 1)
                || (matches!(action.play_policy, PlayPolicy::RandomOne) && action.clip_count < 2)
            {
                return Err(ExecutionModelError::PolicyClipCountMismatch);
            }
            let start = action.first_clip as usize;
            let end = start + action.clip_count as usize;
            let clips = &action_clips[start..end];
            for (position, clip) in clips.iter().enumerate() {
                if clip.0 >= clip_count {
                    return Err(ExecutionModelError::ClipSlotOutOfRange);
                }
                if clips[..position].contains(clip) {
                    return Err(ExecutionModelError::DuplicateClipInAction);
                }
            }
            expected_first = expected_first.saturating_add(action.clip_count);
        }
        if expected_first != flat_clip_count {
            return Err(ExecutionModelError::ClipRangeNotContiguous);
        }
        for clip in 0..clip_count {
            if !action_clips.iter().any(|candidate| candidate.0 == clip) {
                return Err(ExecutionModelError::UnreferencedClip);
            }
        }
        Ok(Self {
            oid_index,
            actions,
            action_clips,
            clip_count,
        })
    }

    /// Returns the dense action count.
    #[must_use]
    pub fn action_count(&self) -> u32 {
        u32::try_from(self.actions.len()).unwrap_or(u32::MAX)
    }

    /// Returns the dense clip count.
    #[must_use]
    pub const fn clip_count(&self) -> u32 {
        self.clip_count
    }

    fn action(&self, slot: ActionSlot) -> &ActionDescriptor {
        &self.actions[slot.0 as usize]
    }

    fn clips(&self, action: &ActionDescriptor) -> &'a [ClipSlot] {
        let start = action.first_clip as usize;
        &self.action_clips[start..start + action.clip_count as usize]
    }
}

/// Injected bounded selector used only by `random_one` actions.
pub trait RandomIndexSource {
    /// Returns a candidate in `0..upper_exclusive`.
    fn select(&mut self, action: ActionSlot, upper_exclusive: u32) -> u32;
}

/// Playback operation produced from one accepted tap.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlaybackPlan<'a> {
    /// Replace current playback with one clip.
    Replace(ClipSlot),
    /// Enqueue every clip in order.
    Queue(&'a [ClipSlot]),
    /// Play one selector-chosen clip.
    RandomOne(ClipSlot),
}

/// Decision produced for one normalized sensor event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeDecision<'a> {
    /// Event was invalid or below the adapter quality gate.
    IgnoreInvalid,
    /// Action remains inside its accepted-play cooldown interval.
    SuppressCooldown(ActionSlot),
    /// Valid code has no action in the active snapshot.
    Unbound(PhysicalCode),
    /// Play the resolved action and clip plan.
    Play {
        /// Dense action slot.
        action_slot: ActionSlot,
        /// Concrete playback plan.
        plan: PlaybackPlan<'a>,
    },
}

/// Runtime initialization or planning errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeError {
    /// Caller-provided cooldown state does not match the action table.
    CooldownStateLengthMismatch,
    /// Injected random selector returned an out-of-range index.
    RandomIndexOutOfRange,
}

/// Deterministic runtime state; memory ownership stays with the composition root.
#[derive(Debug)]
pub struct PointReadRuntime<'model, 'state> {
    model: ExecutionModel<'model>,
    last_played_at: &'state mut [Option<MonotonicUs>],
}

impl<'model, 'state> PointReadRuntime<'model, 'state> {
    /// Creates a runtime over validated execution tables and caller-owned state.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::CooldownStateLengthMismatch`] when the state slice
    /// does not contain exactly one entry per action slot.
    pub fn new(
        model: ExecutionModel<'model>,
        last_played_at: &'state mut [Option<MonotonicUs>],
    ) -> Result<Self, RuntimeError> {
        if last_played_at.len() != model.actions.len() {
            return Err(RuntimeError::CooldownStateLengthMismatch);
        }
        Ok(Self {
            model,
            last_played_at,
        })
    }

    /// Resolves one event without allocation or I/O.
    ///
    /// # Errors
    ///
    /// Returns [`RuntimeError::RandomIndexOutOfRange`] when the injected selector
    /// violates its bounded-index contract.
    pub fn on_event(
        &mut self,
        event: PhysicalCodeEvent,
        selector: &mut impl RandomIndexSource,
    ) -> Result<RuntimeDecision<'model>, RuntimeError> {
        let Some(code) = event.decoded_code() else {
            return Ok(RuntimeDecision::IgnoreInvalid);
        };
        let Some(action_slot) = self.model.oid_index.resolve(code) else {
            return Ok(RuntimeDecision::Unbound(code));
        };
        let action = self.model.action(action_slot);
        let previous = self.last_played_at[action_slot.0 as usize];
        if action.cooldown_us > 0
            && previous
                .is_some_and(|last| event.event_at.0.saturating_sub(last.0) < action.cooldown_us)
        {
            return Ok(RuntimeDecision::SuppressCooldown(action_slot));
        }

        let clips = self.model.clips(action);
        let plan = match action.play_policy {
            PlayPolicy::Replace => PlaybackPlan::Replace(clips[0]),
            PlayPolicy::Queue => PlaybackPlan::Queue(clips),
            PlayPolicy::RandomOne => {
                let selected = selector.select(action_slot, action.clip_count);
                let Some(clip) = clips.get(selected as usize).copied() else {
                    return Err(RuntimeError::RandomIndexOutOfRange);
                };
                PlaybackPlan::RandomOne(clip)
            }
        };
        self.last_played_at[action_slot.0 as usize] = Some(event.event_at);
        Ok(RuntimeDecision::Play { action_slot, plan })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yimi_fw_contract::OidStatus;

    const OIDS: [OidIndexEntry; 4] = [
        OidIndexEntry {
            physical_code: PhysicalCode(10),
            action_slot: ActionSlot(0),
        },
        OidIndexEntry {
            physical_code: PhysicalCode(20),
            action_slot: ActionSlot(1),
        },
        OidIndexEntry {
            physical_code: PhysicalCode(30),
            action_slot: ActionSlot(2),
        },
        OidIndexEntry {
            physical_code: PhysicalCode(40),
            action_slot: ActionSlot(3),
        },
    ];
    const ACTIONS: [ActionDescriptor; 4] = [
        ActionDescriptor {
            play_policy: PlayPolicy::Replace,
            cooldown_us: 500,
            first_clip: 0,
            clip_count: 1,
        },
        ActionDescriptor {
            play_policy: PlayPolicy::Replace,
            cooldown_us: 0,
            first_clip: 1,
            clip_count: 1,
        },
        ActionDescriptor {
            play_policy: PlayPolicy::Queue,
            cooldown_us: 0,
            first_clip: 2,
            clip_count: 2,
        },
        ActionDescriptor {
            play_policy: PlayPolicy::RandomOne,
            cooldown_us: 0,
            first_clip: 4,
            clip_count: 2,
        },
    ];
    const ACTION_CLIPS: [ClipSlot; 6] = [
        ClipSlot(0),
        ClipSlot(1),
        ClipSlot(2),
        ClipSlot(3),
        ClipSlot(4),
        ClipSlot(5),
    ];

    struct FixedSelector(u32);
    impl RandomIndexSource for FixedSelector {
        fn select(&mut self, _action: ActionSlot, _upper_exclusive: u32) -> u32 {
            self.0
        }
    }

    fn model() -> ExecutionModel<'static> {
        ExecutionModel::new(&OIDS, &ACTIONS, &ACTION_CLIPS, 6).unwrap()
    }

    #[test]
    fn compact_model_validates_and_resolves_edges() {
        let model = model();
        assert_eq!(model.action_count(), 4);
        assert_eq!(model.clip_count(), 6);
        assert_eq!(
            model.oid_index.resolve(PhysicalCode(10)),
            Some(ActionSlot(0))
        );
        assert_eq!(
            model.oid_index.resolve(PhysicalCode(40)),
            Some(ActionSlot(3))
        );
        assert_eq!(model.oid_index.resolve(PhysicalCode(25)), None);
    }

    #[test]
    fn interleaved_action_does_not_reset_per_action_cooldown() {
        let mut cooldown = [None; 4];
        let mut runtime = PointReadRuntime::new(model(), &mut cooldown).unwrap();
        let mut selector = FixedSelector(0);
        assert!(matches!(
            runtime.on_event(
                PhysicalCodeEvent::valid(PhysicalCode(10), MonotonicUs(1_000)),
                &mut selector
            ),
            Ok(RuntimeDecision::Play {
                action_slot: ActionSlot(0),
                ..
            })
        ));
        assert!(matches!(
            runtime.on_event(
                PhysicalCodeEvent::valid(PhysicalCode(20), MonotonicUs(1_100)),
                &mut selector
            ),
            Ok(RuntimeDecision::Play {
                action_slot: ActionSlot(1),
                ..
            })
        ));
        assert_eq!(
            runtime.on_event(
                PhysicalCodeEvent::valid(PhysicalCode(10), MonotonicUs(1_200)),
                &mut selector
            ),
            Ok(RuntimeDecision::SuppressCooldown(ActionSlot(0)))
        );
        assert!(matches!(
            runtime.on_event(
                PhysicalCodeEvent::valid(PhysicalCode(10), MonotonicUs(1_500)),
                &mut selector
            ),
            Ok(RuntimeDecision::Play {
                action_slot: ActionSlot(0),
                ..
            })
        ));
    }

    #[test]
    fn queue_and_injected_random_selection_produce_concrete_clips() {
        let mut cooldown = [None; 4];
        let mut runtime = PointReadRuntime::new(model(), &mut cooldown).unwrap();
        let mut selector = FixedSelector(1);
        assert_eq!(
            runtime.on_event(
                PhysicalCodeEvent::valid(PhysicalCode(30), MonotonicUs(1)),
                &mut selector
            ),
            Ok(RuntimeDecision::Play {
                action_slot: ActionSlot(2),
                plan: PlaybackPlan::Queue(&[ClipSlot(2), ClipSlot(3)]),
            })
        );
        assert_eq!(
            runtime.on_event(
                PhysicalCodeEvent::valid(PhysicalCode(40), MonotonicUs(2)),
                &mut selector
            ),
            Ok(RuntimeDecision::Play {
                action_slot: ActionSlot(3),
                plan: PlaybackPlan::RandomOne(ClipSlot(5)),
            })
        );
    }

    #[test]
    fn selector_error_and_invalid_event_do_not_mutate_cooldown() {
        let mut cooldown = [None; 4];
        {
            let mut runtime = PointReadRuntime::new(model(), &mut cooldown).unwrap();
            let mut selector = FixedSelector(9);
            assert_eq!(
                runtime.on_event(
                    PhysicalCodeEvent::valid(PhysicalCode(40), MonotonicUs(2)),
                    &mut selector
                ),
                Err(RuntimeError::RandomIndexOutOfRange)
            );
            let invalid = PhysicalCodeEvent {
                physical_code: Some(PhysicalCode(10)),
                event_at: MonotonicUs(3),
                sensor_at: None,
                ready_at: None,
                quality: Some(0),
                status: OidStatus::LowQuality,
                sequence: 1,
                dropped_events: 0,
            };
            assert_eq!(
                runtime.on_event(invalid, &mut selector),
                Ok(RuntimeDecision::IgnoreInvalid)
            );
        }
        assert_eq!(cooldown, [None; 4]);
    }

    #[test]
    fn malformed_tables_are_rejected() {
        let duplicate_oid = [OIDS[0], OIDS[0]];
        assert!(matches!(
            ExecutionModel::new(&duplicate_oid, &ACTIONS, &ACTION_CLIPS, 6),
            Err(ExecutionModelError::OidIndexNotStrictlySorted)
        ));
        let invalid_actions = [ActionDescriptor {
            play_policy: PlayPolicy::RandomOne,
            cooldown_us: 0,
            first_clip: 0,
            clip_count: 1,
        }];
        assert!(matches!(
            ExecutionModel::new(&OIDS[..1], &invalid_actions, &ACTION_CLIPS[..1], 1),
            Err(ExecutionModelError::PolicyClipCountMismatch)
        ));
    }
}
